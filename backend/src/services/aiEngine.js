const providers = require('./providers');

// How much of each source's body text reaches the prompt. Multiplied by the
// source count and by the number of AI passes, so it moves prompt size fast.
// Raise alongside MAX_NEWS_SOURCES once the Groq plan is upgraded.
const SOURCE_BODY_CHARS = Number(process.env.SOURCE_BODY_CHARS) || 140;

/**
 * Turns raw prospect research into a seller-specific intelligence report.
 *
 * Everything here is written through three lenses, supplied per request:
 *   1. what the seller's COMPANY can deliver (organization capabilities)
 *   2. what THIS SELLER sells into their vertical (vertical capabilities)
 *   3. the KEYWORDS they want to pitch (e.g. "GenAI", "Copilot")
 *
 * The keyword lens is the strongest: a report for keywords "GenAI, Copilot"
 * must read as "here is where this prospect needs GenAI and Copilot", not as a
 * generic company profile.
 */
class AIEngine {
  // True when at least one provider in the chain has a usable key
  get enabled() {
    return providers.available().length > 0;
  }

  // The model that actually served the last completion, for Report.aiModel.
  // Before the first call there is nothing to report, so name the provider that
  // would take it rather than hard-coding one of the three.
  get lastModel() {
    if (this._lastModel) return this._lastModel;
    const next = providers.available()[0];
    return next ? `${next.name}/${next.model}` : 'unconfigured';
  }

  // ---- transport ---------------------------------------------------------

  async complete(prompt, { maxTokens = 2048, json = false, system } = {}) {
    if (!this.enabled) {
      throw new Error(
        'No AI provider is configured - set the AZURE_OPENAI_* keys (or GROQ_API_KEY / GEMINI_API_KEY) - reports cannot be generated'
      );
    }

    try {
      const { text, provider, model } = await providers.complete({
        system,
        prompt,
        maxTokens,
        json,
      });

      this._lastModel = `${provider}/${model}`;
      return text;
    } catch (error) {
      throw this.friendlyError(error);
    }
  }

  /**
   * Provider errors surface verbatim in the UI, and a raw Groq JSON blob tells
   * a salesperson nothing. Rate limits in particular need to say what to do.
   */
  friendlyError(error) {
    const status = error?.status || error?.response?.status;
    const detail = error?.error?.message || error?.response?.data?.error?.message || error?.message || '';
    // By the time an error reaches here every configured provider has already
    // been tried, so the message must read as "all of them", not "the AI".
    const many = providers.available().length > 1;
    const who = many ? 'Every configured AI provider' : 'The AI provider';

    // A single request larger than the whole per-minute allowance. Retrying
    // cannot help - the prompt itself has to shrink.
    if (status === 413) {
      return new Error(
        `${who} rejected the request as too large. Lower MAX_NEWS_SOURCES / SOURCE_BODY_CHARS ` +
          'in the server .env, or upgrade the plan for a higher per-minute limit.'
      );
    }

    if (status === 429) {
      const retry = /try again in ([^.]+)/i.exec(detail)?.[1];
      const daily = /per day|TPD/i.test(detail);

      return new Error(
        daily
          ? `${who} has used up its daily token allowance${retry ? ` — it resets in ${retry.trim()}` : ''}. ` +
            'Each report costs roughly 15-25k tokens; add another provider key or upgrade the plan.'
          : `${who} is rate limiting requests${retry ? ` — retry in ${retry.trim()}` : ''}.`
      );
    }

    if (status === 401 || status === 403) {
      return new Error(
        'The AI provider rejected the API key. Check AZURE_OPENAI_API_KEY, GROQ_API_KEY and GEMINI_API_KEY on the server.'
      );
    }

    if (status >= 500) {
      return new Error(`${who} is temporarily unavailable. Try generating the report again shortly.`);
    }

    return new Error(detail ? `AI request failed: ${detail.slice(0, 220)}` : 'AI request failed');
  }

  // Models occasionally wrap JSON in prose or fences even in JSON mode, so pull
  // out the outermost object before parsing rather than failing the whole report.
  parseJSON(text) {
    if (!text) return null;

    const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();

    try {
      return JSON.parse(cleaned);
    } catch (_) {
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start === -1 || end <= start) return null;
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch (_) {
        return null;
      }
    }
  }

  // One retry with a blunter instruction; a single bad completion should not
  // cost the user the whole report.
  async completeJSON(prompt, { maxTokens = 3000, label = 'section' } = {}) {
    const system =
      'You are a senior B2B sales-intelligence analyst. You reply with a single valid JSON object and nothing else. ' +
      'Never invent facts: every claim must be traceable to the numbered SOURCES provided, and you must cite them.';

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const raw = await this.complete(
          attempt === 0
            ? prompt
            : `${prompt}\n\nCRITICAL: return ONLY the raw JSON object. No markdown, no commentary.`,
          { maxTokens, json: true, system }
        );

        const parsed = this.parseJSON(raw);
        if (parsed) return parsed;

        console.warn(`⚠️ AI returned unparsable JSON for ${label} (attempt ${attempt + 1})`);
      } catch (error) {
        console.error(`❌ AI error on ${label} (attempt ${attempt + 1}):`, error.message);
        if (attempt === 1) throw error;
      }
    }

    return {};
  }

  // ---- prompt building ---------------------------------------------------

  list(values, fallback = 'not specified') {
    const items = (values || []).filter(Boolean);
    return items.length ? items.join(', ') : fallback;
  }

  /**
   * The long-form answers an admin writes on the company profile. Only the
   * sections that were filled in are emitted, and each is trimmed so a verbose
   * profile cannot crowd the prospect evidence out of the context window.
   */
  sellerNarrative(seller, maxChars = 1200) {
    const sections = [
      ['Product features and capabilities', seller.productFeatures],
      ['Problems, pains and challenges they solve', seller.problemsSolved],
      ['Outcomes and benefits delivered', seller.outcomesDelivered],
      ['Competitors and differentiation', seller.competitorsDifferentiation],
      ['Case studies and testimonials', seller.caseStudies],
      ['Industry terminology to use', seller.industryTerminology],
    ]
      .filter(([, body]) => String(body || '').trim())
      .map(([label, body]) => `${label}: ${String(body).replace(/\s+/g, ' ').trim().slice(0, maxChars)}`);

    const monitoring = [
      seller.relevantTopics?.length ? `Topics they monitor: ${this.list(seller.relevantTopics)}` : '',
      seller.relevantTechnologies?.length ? `Technologies they care about: ${this.list(seller.relevantTechnologies)}` : '',
      seller.relevantContactTitles?.length ? `Buying-committee titles they track: ${this.list(seller.relevantContactTitles)}` : '',
      seller.relevantHiringTitles?.length ? `Hiring titles they treat as a signal: ${this.list(seller.relevantHiringTitles)}` : '',
    ].filter(Boolean);

    return [...sections, ...monitoring].join('\n');
  }

  /**
   * What the seller's own CRM holds on this prospect. This is first-party truth
   * rather than inference, so the prompt says so explicitly - the model must not
   * contradict it or re-derive facts it has been handed.
   */
  crmBlock(crm, prospectName) {
    if (!crm?.matched) return '';

    const money = value =>
      typeof value === 'number' && Number.isFinite(value) ? Math.round(value).toLocaleString() : null;

    const deals = (crm.openOpportunities || []).slice(0, 8).map(o =>
      `  - ${o.name} | stage: ${o.stage || 'unset'}${o.amount ? ` | ${money(o.amount)}` : ''}` +
      `${o.closeDate ? ` | closes ${new Date(o.closeDate).toISOString().slice(0, 10)}` : ''}` +
      `${o.nextStep ? ` | next step: ${o.nextStep}` : ''}`
    );

    const contacts = (crm.contacts || []).slice(0, 10).map(c =>
      `  - ${c.name}${c.title ? `, ${c.title}` : ''}${c.department ? ` (${c.department})` : ''}`
    );

    const activities = (crm.activities || []).slice(0, 8).map(a =>
      `  - ${a.occurredAt ? `${new Date(a.occurredAt).toISOString().slice(0, 10)}: ` : ''}` +
      `${a.subject || a.kind}${a.summary ? ` — ${a.summary.slice(0, 160)}` : ''}`
    );

    const daysSinceActivity = crm.lastActivityAt
      ? Math.round((Date.now() - new Date(crm.lastActivityAt).getTime()) / 86400000)
      : null;

    return `
=== WHAT THE SELLER'S OWN CRM SAYS (first-party, authoritative) ===
Source: ${crm.provider === 'zoho' ? 'Zoho CRM' : 'Salesforce'}, synced ${new Date(crm.fetchedAt).toISOString().slice(0, 10)}
Account owner: ${crm.account?.owner || 'unassigned'}${crm.account?.type ? ` | relationship: ${crm.account.type}` : ''}${crm.account?.rating ? ` | rating: ${crm.account.rating}` : ''}
Open pipeline: ${money(crm.openPipeline) || '0'} across ${crm.openOpportunities?.length || 0} deal(s)
Closed-won history: ${crm.wonOpportunities?.length || 0} deal(s)
Last logged activity: ${daysSinceActivity === null ? 'never' : `${daysSinceActivity} days ago`}
${deals.length ? `Open deals:\n${deals.join('\n')}` : 'No open deals recorded.'}
${contacts.length ? `Known contacts:\n${contacts.join('\n')}` : ''}
${activities.length ? `Recent CRM activity:\n${activities.join('\n')}` : ''}

Rules for using this:
  - Treat it as fact. Never contradict it, and never describe ${prospectName} as a cold prospect
    if there is open pipeline or closed-won history above.
  - Write to the actual position: an open deal means advance it (what unblocks the current stage),
    an existing customer means expand it, no deals means create the opening.
  - Name the account owner's live deals and known contacts where they are relevant, and tie the
    public evidence below back to them.
  - If CRM activity is stale but pipeline is open, call that out as a risk.`.trim();
  }

  /**
   * The block every prompt shares. Repeating the lens in each call is what keeps
   * a four-call report coherent instead of four unrelated essays.
   */
  buildContext({ seller, profile, prospect, crm = null }) {
    const keywords = (profile.keywords || []).filter(Boolean);

    return `
=== WHO IS SELLING (the reader of this report) ===
Seller company: ${seller.name}${seller.industry ? ` (${seller.industry})` : ''}
What they do: ${seller.description || 'not specified'}
Company capabilities they can deliver: ${this.list(seller.capabilities)}
${seller.capabilityNotes ? `Capability detail: ${seller.capabilityNotes}` : ''}
Company value propositions: ${this.list(seller.valuePropositions)}
Proof points / differentiators: ${this.list([...(seller.proofPoints || []), ...(seller.differentiators || [])])}
${this.sellerNarrative(seller)}
Sales rep: ${profile.name}${profile.jobTitle ? `, ${profile.jobTitle}` : ''}
Vertical they sell into: ${profile.vertical || seller.industry || 'not specified'}
Capabilities they sell in that vertical: ${this.list(profile.verticalCapabilities)}
Departments/roles they target: ${this.list([...(profile.targetDepartments || []), ...(profile.targetRoles || [])])}

=== PITCH FOCUS (THE PRIMARY LENS - THIS OVERRIDES EVERYTHING) ===
Focus keywords: ${keywords.length ? keywords.join(', ') : 'general capability fit'}
${keywords.length ? `
The reader is pitching ${keywords.join(' and ')}. Write the ENTIRE report to answer:
  "Where and why does ${prospect.name} need ${keywords.join(' / ')}, and how do we prove it?"
Rules:
  - Every insight, opportunity, challenge and talking point must connect back to ${keywords.join(' or ')}
    OR to a business condition that creates demand for them.
  - Quantify with real figures from the sources whenever available.
  - If a source shows ${prospect.name} already investing in ${keywords.join(' / ')}, say so explicitly and
    describe the gap the reader can fill (scale, governance, production rollout, cost, compliance).
  - Do NOT produce a generic company profile.` : ''}

=== WHO IS BEING SOLD TO (the prospect) ===
Company: ${prospect.name}${prospect.ticker ? ` (${prospect.ticker})` : ''}
Industry: ${prospect.industry || 'unknown'}
Headquarters: ${prospect.country || 'unknown'}
Employees: ${prospect.employees ? Number(prospect.employees).toLocaleString() : 'unknown'}
Website: ${prospect.website || 'unknown'}
About: ${(prospect.description || 'no description available').slice(0, 900)}
Financials: market cap ${this.money(prospect.financials?.marketCap)}, revenue ${this.money(prospect.financials?.revenue)}, revenue growth ${prospect.financials?.revenueGrowth ?? 'n/a'}%, P/E ${prospect.financials?.peRatio ?? 'n/a'}

${this.crmBlock(crm, prospect.name)}
`.trim();
  }

  money(value) {
    if (!value && value !== 0) return 'n/a';
    const n = Number(value);
    if (Number.isNaN(n)) return 'n/a';
    if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
    if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    return `$${n.toLocaleString()}`;
  }

  buildSources(sources) {
    if (!sources?.length) {
      return 'No external sources were retrieved. Rely only on the company profile above and say so where evidence is thin.';
    }

    return sources
      .map(s => {
        const date = s.publishedAt ? new Date(s.publishedAt).toISOString().slice(0, 10) : 'undated';
        const body = (s.description || s.snippet || '').replace(/\s+/g, ' ').slice(0, SOURCE_BODY_CHARS);
        return `[${s.index}] (${s.type}) ${s.title} — ${s.source || 'unknown'} — ${date}${body ? `\n     ${body}` : ''}`;
      })
      .join('\n');
  }

  // Shared JSON contract note appended to every prompt
  get citationRule() {
    return `
Every array element that carries a claim is an object: {"text": "...", "citations": [1, 4]}
- "citations" holds SOURCE numbers from the SOURCES list. Use [] only when the claim comes from the company profile.
- Each "text" is 25-45 words: state the fact, then what it MEANS for the reader. Name figures, products, regions, executives and dates.
- Never copy a headline as-is. "Company X launches Y" is not an insight; "Company X launched Y across three markets, which means Z is now an operational problem they must staff for" is.
- No filler, no hedging, no "as an AI", no restating the instructions.`;
  }

  // ---- report sections ---------------------------------------------------

  /** Page group 1 — the executive brief a rep reads before a call. */
  async generateExecutiveBrief(context, sources) {
    const prompt = `${context}

=== SOURCES ===
${this.buildSources(sources)}

=== TASK ===
Produce the "What You Need To Know" brief. Return JSON with exactly these keys:

{
  "keyInsights":     [7 items],   // the most important, decision-relevant developments, each tied to the pitch focus
  "opportunities":   [5 items],   // specific engagements the SELLER can pitch, naming the seller capability used
  "challenges":      [4 items],   // problems/risks the prospect faces that the seller's capabilities address
  "peopleUpdates":   [3 items],   // leadership moves, hiring patterns and what they signal about budget/ownership
  "talkingPoints":   [4 items],   // first-call openers: reference a real fact, then the ask. Written to be said aloud.
  "topNews":         [4 objects], // {"title","summary","source","url","publishedAt","citations":[n]} - real headlines from SOURCES only
  "executivePerspective": [3 objects] // {"quote","person","title","source","citations":[n]} - verbatim quotes found in SOURCES. If none exist, return []. NEVER fabricate a quote.
}
${this.citationRule}`;

    return this.completeJSON(prompt, { maxTokens: 4000, label: 'executive brief' });
  }

  /** Page group 2a — company research. */
  async generateResearch(context, sources) {
    const prompt = `${context}

=== SOURCES ===
${this.buildSources(sources)}

=== TASK ===
Produce the "Research & Analysis / Insights" section. Return JSON with exactly these keys:

{
  "companyOverview":   [3 items],  // what the company is and how it makes money today
  "keyPeopleChanges":  [3 items],  // named executives, their remit, and what their arrival/exit changes
  "keyProjects":       [4 items],  // live programmes, pilots and platform builds - prioritise ones touching the pitch focus
  "aspirations":       [3 items],  // stated ambitions in the company's own framing
  "businessGoals":     [3 items],  // measurable targets: growth, cost, margin, market share, with numbers where known
  "macroPerspective":  [3 items],  // market, rate, regulatory and competitive conditions shaping their decisions
  "recentPress":       [4 items]   // notable announcements with dates
}
${this.citationRule}`;

    return this.completeJSON(prompt, { maxTokens: 4000, label: 'research' });
  }

  /** Page group 2b — business model, initiatives, financials and SWOT. */
  async generateStrategy(context, sources) {
    const prompt = `${context}

=== SOURCES ===
${this.buildSources(sources)}

=== TASK ===
Produce the "Business Model / Strategic Initiatives / Financials / SWOT" section. Return JSON with exactly these keys:

{
  "businessModel": {
    "revenueStreams":       [2 items],
    "goToMarket":           [2 items],
    "idealCustomerProfile": [2 items]
  },
  "strategicInitiatives": [4 items],  // the programmes the prospect is funding, and the operational load each creates
  "financials":           [3 items],  // performance, guidance and what it implies for discretionary spend
  "swot": {
    "strengths":     [3 items],  // strengths FROM THE SELLER'S ANGLE: why this prospect can buy and absorb what we sell
    "weaknesses":    [2 items],  // gaps and constraints that would slow or block a deal
    "opportunities": [4 items],  // where the seller's capabilities and the pitch focus create value for the prospect
    "threats":       [2 items]   // external risks to the engagement: regulation, macro, competing vendors
  }
}
${this.citationRule}`;

    return this.completeJSON(prompt, { maxTokens: 4000, label: 'strategy' });
  }

  /** Page group 3 — the value story the rep actually pitches. */
  async generateValue(context, sources, brief) {
    const anchor = [
      ...(brief?.keyInsights || []).slice(0, 5).map(i => i.text || i),
      ...(brief?.opportunities || []).slice(0, 4).map(i => i.text || i),
    ].filter(Boolean).map(t => `- ${t}`).join('\n');

    const prompt = `${context}

=== SOURCES ===
${this.buildSources(sources)}

=== ALREADY ESTABLISHED IN THIS REPORT (build on these, do not repeat them verbatim) ===
${anchor || 'nothing yet'}

=== TASK ===
Produce the "Value" section - the argument the rep makes in the room. Return JSON with exactly these keys:

{
  "whyChange": [4 items],   // why the prospect's status quo fails them - evidence-led, not generic
  "whyNow":    [4 items],   // the timing trigger: a deadline, a target, a hire, a launch, a regulation
  "whyYou":    [4 items],   // why THIS seller specifically, naming their capabilities and proof points
  "valuePyramid": {
    "companyGoals":        [2 items],  // the prospect's own goals, in their language
    "businessStrategy":    [2 items],  // how they intend to get there
    "challengesObstacles": [3 items],  // what stands in the way
    "valuePaths":          [5 items]   // concrete workstreams the seller can own, each with a measurable outcome
  },
  "valuePropositions": [5 objects],    // {"title": "short name", "body": "90-130 word pitch naming the seller capability, the prospect's situation and the expected business outcome", "citations":[n]}
  "hypotheses": [4 items],             // testable bets about where value is trapped, phrased "If X, then Y"
  "pointOfView": [4 items]             // the seller's candid read of the account: what is really going on and where to push
}
${this.citationRule}`;

    return this.completeJSON(prompt, { maxTokens: 5000, label: 'value' });
  }

  /** Short natural-language read on why the account scored the way it did. */
  async summariseScore(context, score) {
    try {
      const prompt = `${context}

The prospect scored ${score.value}/100 on fit for this seller. Signal breakdown: ${JSON.stringify(score.breakdown)}.
Contributing observations: ${score.reasons.join('; ') || 'none'}.

Return JSON: {"summary": "one sentence, max 32 words, explaining what the score means for prioritising this account"}`;

      const result = await this.completeJSON(prompt, { maxTokens: 300, label: 'score summary' });
      return result?.summary || '';
    } catch (_) {
      return '';
    }
  }

  /** Used by the signals feed - unchanged contract, kept plain text. */
  async analyzeSignal(signal, companyContext) {
    if (!this.enabled) return '';

    try {
      const text = await this.complete(
        `Analyse this sales signal for ${companyContext.company}.

Signal: ${signal.title}
Detail: ${signal.description || 'n/a'}
${companyContext.keywords?.length ? `The reader is pitching: ${companyContext.keywords.join(', ')}. Bias the analysis toward that.` : ''}

Answer in three short labelled lines: Impact:, Opportunity:, Next step:`,
        { maxTokens: 400 }
      );
      return text.trim();
    } catch (error) {
      console.error('❌ AI error analyzing signal:', error.message);
      return '';
    }
  }
}

module.exports = new AIEngine();
