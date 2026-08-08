const providers = require('./providers');

// How much of each source's body text reaches the prompt. Multiplied by the
// source count and by the number of AI passes, so it moves prompt size fast.
// Raise alongside MAX_NEWS_SOURCES once the Groq plan is upgraded.
const SOURCE_BODY_CHARS = Number(process.env.SOURCE_BODY_CHARS) || 140;

/**
 * Turns raw prospect research into a seller-specific intelligence report.
 *
 * There is exactly one lens: the seller's COMPANY PROFILE. Every field an admin
 * fills in - what the company sells, the problems it solves, the proof it can
 * cite, the titles, technologies and topics it monitors - reaches the prompt.
 *
 * Within that profile the monitored TOPICS carry a priority, and the
 * high-priority ones are the strongest signal in the whole prompt: a report for
 * a company whose priority topics are "GenAI, Cloud migration" must read as
 * "here is where this prospect needs GenAI and cloud migration", not as a
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
      seller.priorityTopics?.length
        ? `Topics they monitor — HIGH PRIORITY: ${this.list(seller.priorityTopics)}`
        : '',
      seller.standardTopics?.length
        ? `Topics they monitor — standard priority: ${this.list(seller.standardTopics)}`
        : '',
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
   * The records the pipeline extracted before the model was called.
   *
   * These are the report's load-bearing facts - a named programme, a dated
   * executive move, a filed result, a counted set of open roles - and every one
   * was read out of a primary source in code. The model is handed them as
   * settled so it writes around them: it must lead with them, must not restate
   * a figure differently, and must not invent a sibling for one.
   *
   * The alternative is asking a model to produce these itself, which produces a
   * plausible programme name for an account that never announced one.
   */
  evidenceBlock(evidence = {}) {
    const money = value => {
      const n = Number(value);
      if (!Number.isFinite(n)) return null;
      if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
      if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
      return `$${n.toLocaleString()}`;
    };

    const day = value =>
      value ? new Date(value).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'undated';

    const blocks = [];

    const programs = evidence.strategicPrograms || [];
    if (programs.length) {
      blocks.push(
        `NAMED PROGRAMMES (highest-priority triggers - lead with these):\n` +
        programs.slice(0, 4).map(p =>
          `  - "${p.name}"${p.headlineNumber ? `, ${p.headlineNumber}` : ''}, announced ${day(p.announcedAt)}` +
          `${p.citations?.length ? ` [${p.citations.join(', ')}]` : ''}`
        ).join('\n')
      );
    }

    const regulatory = evidence.regulatoryActions || [];
    if (regulatory.length) {
      blocks.push(
        `REGULATORY ACTIONS (same priority tier as programmes - regulation creates\n` +
        `obligation with a deadline, not merely opportunity):\n` +
        regulatory.slice(0, 4).map(r =>
          `  - ${r.regulator}, ${r.actionType}, ${day(r.announcedAt)}: ${(r.detail || '').slice(0, 160)}` +
          `${r.citations?.length ? ` [${r.citations.join(', ')}]` : ''}`
        ).join('\n')
      );
    }

    const moves = evidence.executiveMoves || [];
    if (moves.length) {
      blocks.push(
        `VERIFIED EXECUTIVE MOVES (already rendered in the report - do not list them\n` +
        `again; write what they mean for budget ownership and timing):\n` +
        moves.slice(0, 6).map(m =>
          `  - ${m.person}${m.role ? `, ${m.role}` : ''}, ${m.movement}, ${day(m.announcedAt)}` +
          `${m.counterparty ? `, from/to ${m.counterparty}` : ''}` +
          `${m.citations?.length ? ` [${m.citations.join(', ')}]` : ''}`
        ).join('\n')
      );
    }

    const results = evidence.financial?.latestResults;
    if (results && (results.revenue || results.profit || results.eps)) {
      const parts = [
        results.revenue ? `revenue ${money(results.revenue)}` : null,
        results.profit ? `net income ${money(results.profit)}` : null,
        Number.isFinite(results.eps) ? `diluted EPS $${Number(results.eps).toFixed(2)}` : null,
        results.buybackAmount ? `buybacks ${money(results.buybackAmount)}` : null,
      ].filter(Boolean).join(', ');

      blocks.push(
        `LATEST REPORTED RESULTS (filed figures - quote them exactly as written here,\n` +
        `never round differently, never estimate a figure that is absent):\n` +
        `  - ${results.period || 'latest period'}: ${parts}` +
        `${results.citations?.length ? ` [${results.citations.join(', ')}]` : ''}`
      );
    }

    if (evidence.hiring?.summary) {
      blocks.push(
        `HIRING (counted from the company's own job board - this exact sentence is\n` +
        `already rendered; do not restate the number, build on what it implies):\n` +
        `  - ${evidence.hiring.summary}` +
        `${evidence.hiring.citations?.length ? ` [${evidence.hiring.citations.join(', ')}]` : ''}`
      );
    }

    const patents = evidence.patents || [];
    if (patents.length) {
      blocks.push(
        `PATENT ACTIVITY (R&D direction, months ahead of any announcement):\n` +
        patents.slice(0, 5).map(p =>
          `  - "${p.title}", ${p.status}, ${day(p.grantedAt || p.filedAt)}` +
          `${p.citations?.length ? ` [${p.citations.join(', ')}]` : ''}`
        ).join('\n')
      );
    }

    const awards = evidence.contractAwards || [];
    if (awards.length) {
      blocks.push(
        `US FEDERAL CONTRACT AWARDS (public record - dated, exact, not press spin):\n` +
        awards.slice(0, 5).map(a =>
          `  - ${money(a.amount) || 'undisclosed'}, ${a.agency}, from ${day(a.startedAt)}` +
          `${a.citations?.length ? ` [${a.citations.join(', ')}]` : ''}`
        ).join('\n')
      );
    }

    if (!blocks.length) return '';

    return `
=== VERIFIED RECORDS (extracted from primary sources, NOT by you) ===
Every line below was read out of a filing, a job board, a public register or a
dated article. Treat all of it as settled fact.

${blocks.join('\n\n')}

Rules for using these:
  - Lead with the named programmes and regulatory actions. They are the strongest
    triggers in this report and belong at the top of Key Insights.
  - At least one talking point must name a programme above verbatim and open on it.
  - Never restate one of these figures with a different number, a different date
    or a different name.
  - Never invent a companion record - a second programme, another executive, a
    figure for a quarter that is not listed. If it is not above and not in the
    SOURCES, it does not exist for the purposes of this report.`.trim();
  }

  /**
   * The block every prompt shares. Repeating the lens in each call is what keeps
   * a multi-call report coherent instead of several unrelated essays.
   */
  buildContext({ seller, prospect, crm = null, evidence = null }) {
    const priority = (seller.priorityTopics || []).filter(Boolean);
    const standard = (seller.standardTopics || []).filter(Boolean);
    const focus = (seller.focusTerms || []).filter(Boolean);

    return `
=== WHO IS SELLING (the company this report is written for) ===
Seller company: ${seller.name}${seller.industry ? ` (${seller.industry})` : ''}
${seller.headquarters ? `Headquartered in: ${seller.headquarters}` : ''}
${seller.website ? `Website: ${seller.website}` : ''}
${seller.employeeBand ? `Size: ${seller.employeeBand}` : ''}
What they do: ${seller.description || 'not specified'}
Company capabilities they can deliver: ${this.list(seller.capabilities)}
${seller.capabilityNotes ? `Capability detail: ${seller.capabilityNotes}` : ''}
Company value propositions: ${this.list(seller.valuePropositions)}
Proof points / differentiators: ${this.list([...(seller.proofPoints || []), ...(seller.differentiators || [])])}
Industries they sell into: ${this.list(seller.targetIndustries)}
Departments they sell to: ${this.list(seller.targetDepartments)}
Buyer roles they target: ${this.list(seller.targetRoles)}
${this.sellerNarrative(seller)}

=== REPORT FOCUS (THE PRIMARY LENS - THIS OVERRIDES EVERYTHING) ===
${priority.length ? `HIGH-PRIORITY topics: ${priority.join(', ')}` : ''}
${standard.length ? `Standard-priority topics: ${standard.join(', ')}` : ''}
${focus.length ? `
Write the ENTIRE report to answer:
  "Where and why does ${prospect.name} need ${focus.join(' / ')}, and how do we prove it?"
Rules:
  - Every insight, opportunity, challenge and talking point must connect back to ${focus.join(' or ')}
    OR to a business condition that creates demand for them.${priority.length && standard.length ? `
  - WEIGHTING IS NOT OPTIONAL. ${priority.join(', ')} ${priority.length === 1 ? 'is' : 'are'} high priority:
    lead with ${priority.length === 1 ? 'it' : 'them'}, give ${priority.length === 1 ? 'it' : 'them'} the most items in every
    section, and place ${priority.length === 1 ? 'it' : 'them'} first within each list. Treat ${standard.join(', ')}
    as supporting context - include ${standard.length === 1 ? 'it' : 'them'} only where the evidence is genuinely strong,
    and never at the expense of a high-priority topic.` : ''}
  - Where the evidence supports it, tie claims to the technologies and buying-committee titles listed above.
  - Quantify with real figures from the sources whenever available.
  - If a source shows ${prospect.name} already investing in ${focus.join(' / ')}, say so explicitly and
    describe the gap the seller can fill (scale, governance, production rollout, cost, compliance).
  - Do NOT produce a generic company profile.` : 'No topics or capabilities are configured — fall back to a general capability-fit read.'}

=== WHO IS BEING SOLD TO (the prospect) ===
Company: ${prospect.name}${prospect.ticker ? ` (${prospect.ticker})` : ''}
Industry: ${prospect.industry || 'unknown'}
Headquarters: ${prospect.country || 'unknown'}
Employees: ${prospect.employees ? Number(prospect.employees).toLocaleString() : 'unknown'}
Website: ${prospect.website || 'unknown'}
About: ${(prospect.description || 'no description available').slice(0, 900)}
Financials: market cap ${this.money(prospect.financials?.marketCap)}, revenue ${this.money(prospect.financials?.revenue)}, revenue growth ${prospect.financials?.revenueGrowth ?? 'n/a'}%, P/E ${prospect.financials?.peRatio ?? 'n/a'}

${this.crmBlock(crm, prospect.name)}

${evidence ? this.evidenceBlock(evidence) : ''}
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
- AT MOST 3 citations per claim, and only sources that genuinely support it. A longer source
  list is not a licence to cite more: pick the strongest evidence, not all of it.
- Each "text" is 55-85 words and runs to three or four complete sentences, in this order:
    1. the fact, with the figures, products, regions, executives and dates that make it specific;
    2. the scale or context that says how big a deal it is for a company this size;
    3. what it MEANS for the reader - the operational or commercial consequence;
    4. the opening it creates for the seller, or the risk if it is ignored.
- Write it so a rep who reads it once can retell it from memory. Never leave a sentence fragment,
  a bare headline or a one-line summary - a thin bullet is a failed bullet.
- Never copy a headline as-is. "Company X launches Y" is not an insight; "Company X launched Y across three markets, which means Z is now an operational problem they must staff for" is.
- No filler, no hedging, no "as an AI", no restating the instructions. Detail means more specifics, not more adjectives.`;
  }

  /**
   * Talking points are the one section a rep reads WHILE talking, so they are
   * not bullets - each is a small script: the fact to open with, the meaning,
   * the bridge to what we sell, the question to ask, the proof to drop and the
   * pushback to expect. Long on purpose: it has to be recallable mid-sentence.
   */
  get talkingPointRule() {
    return `
TALKING POINT CONTRACT (this section is not a bullet list - do not compress it):
Each talking point is an object with exactly these keys:
{
  "headline":  "6-10 words the rep can find at a glance, e.g. 'FY26 core-banking migration deadline'",
  "text":      "120-170 words, written to be spoken out loud. Sentences 1-2: the specific fact - name the programme, executive, figure, region and date drawn from the SOURCES. Sentences 3-4: why it matters to THIS prospect's numbers, timeline or risk. Sentences 5-6: the bridge to the seller's named capability and the outcome it produces.",
  "question":  "the exact open question to ask out loud, 15-30 words, impossible to answer with yes or no",
  "proof":     "30-50 words: the seller proof point, customer story or metric to drop if the prospect leans in - only from the seller profile above, never invented",
  "objection": "30-50 words: the most likely pushback in the prospect's own words, then the one-sentence answer to it",
  "citations": [1, 4]
}
Rules:
- Enough detail that the rep can recall the whole point from a glance mid-meeting. Never a single sentence.
- Do not restate a Key Insight verbatim - a talking point is the spoken version with the ask attached.
- Each one opens a different door: no two may lead to the same question.
- The first talking points belong to the high-priority topics named in the REPORT FOCUS above.
- If the VERIFIED RECORDS list a named programme, at least one talking point must open on it
  BY NAME - "Your May 2026 growth plan targets 15% RoTE - here is how we accelerate it."
  A programme the prospect announced is the strongest opening line available to a rep.`;
  }

  /**
   * The whitespace read - where the account is investing before it has said so.
   *
   * Patents and federal awards are dated public record, and they run months
   * ahead of the announcement they belong to. That makes them the wrong thing
   * to open a call with and the right thing to shape a roadmap around, so this
   * pass is asked for direction rather than triggers.
   */
  get whitespaceRule() {
    return `
This section is about DIRECTION, not events. A patent is not a reason to call today -
it is evidence of where the account will need capability in twelve months. Write it that way.
- Ground every claim in a patent or award listed in the VERIFIED RECORDS. No record, no claim.
- Say what the filing or award implies they are building, then what they will need to run it
  at scale - the operational, data, compliance or staffing load that follows.
- Never infer a product launch, a revenue figure or a customer from a patent. A filing means
  they explored something, not that they shipped it.`;
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
  "keyInsights":     [7 items],   // the most important, decision-relevant developments, each tied to the report focus
  "opportunities":   [5 items],   // specific engagements the SELLER can pitch, naming the seller capability used and the outcome it buys
  "challenges":      [4 items],   // problems/risks the prospect faces that the seller's capabilities address, with the cost of leaving them unsolved
  "peopleUpdates":   [3 items],   // what the leadership changes MEAN for budget ownership, decision timing and who to call - not a re-list of the moves
  "talkingPoints":   [5 objects], // see the TALKING POINT CONTRACT below - the longest section in the report
  "topNews":         [4 objects], // {"title","summary","source","url","publishedAt","citations":[n]} - real headlines from SOURCES only, "summary" 40-60 words
  "executivePerspective": [3 objects] // see the QUOTE CONTRACT below. If nothing clears the bar, return []. NEVER fabricate a quote.
}

QUOTE CONTRACT (this section is dropped from the report entirely rather than shown weak):
Each quote is {"quote","person","title","source","citations":[n]} and needs ALL of:
  - "quote": the words verbatim from a SOURCE. Never paraphrase, never assemble one from a summary.
  - "person": the speaker's actual name. "a spokesperson", "the CEO", "management" is a REJECT -
    if the source does not name them, the quote cannot be used.
  - "title": their role. A name with no job title tells the reader nothing about whether this
    person controls the budget.
  - "citations": the SOURCE the quote was read from - it supplies the date and the link.
Prefer quotes connected to a named programme, a regulatory action or a trigger event above.
Returning [] is a correct and expected answer. Three is the maximum; fewer is fine.
${this.citationRule}
${this.talkingPointRule}`;

    return this.completeJSON(prompt, { maxTokens: 8000, label: 'executive brief' });
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
  "keyProjects":       [4 items],  // live programmes, pilots and platform builds - prioritise ones touching the report focus
  "aspirations":       [3 items],  // stated ambitions in the company's own framing
  "businessGoals":     [3 items],  // measurable targets: growth, cost, margin, market share, with numbers where known
  "macroPerspective":  [3 items],  // market, rate, regulatory and competitive conditions shaping their decisions
  "recentPress":       [4 items]   // notable announcements with dates
}
${this.citationRule}`;

    return this.completeJSON(prompt, { maxTokens: 6000, label: 'research' });
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
    "opportunities": [4 items],  // where the seller's capabilities and the report focus create value for the prospect
    "threats":       [2 items]   // external risks to the engagement: regulation, macro, competing vendors
  }
}
${this.citationRule}`;

    return this.completeJSON(prompt, { maxTokens: 6000, label: 'strategy' });
  }

  /** Whitespace Identification — R&D and public-sector direction. */
  async generateWhitespace(context, sources, evidence = {}) {
    const patents = (evidence.patents || []).length;
    const awards = (evidence.contractAwards || []).length;

    const prompt = `${context}

=== SOURCES ===
${this.buildSources(sources)}

=== TASK ===
Produce the "Whitespace Identification" section from the ${patents} patent record(s) and
${awards} federal award(s) in the VERIFIED RECORDS above. Return JSON with exactly these keys:

{
  "insights":       [4 items],  // what the patent and contract activity says about where this account is heading, each naming the specific filing or award it reads from
  "capabilityGaps": [3 items]   // the capability the account will need to operationalise that direction, and the opening it creates for the seller
}
${this.whitespaceRule}
${this.citationRule}`;

    return this.completeJSON(prompt, { maxTokens: 4000, label: 'whitespace' });
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
  "valuePropositions": [5 objects],    // {"title": "short name", "body": "140-190 word pitch: the prospect's situation with its figures, the seller capability by name, how it is delivered, and the expected business outcome with a number or timeframe", "citations":[n]}
  "hypotheses": [4 items],             // testable bets about where value is trapped, phrased "If X, then Y", each with the evidence behind the bet and how to test it on a call
  "pointOfView": [4 items]             // the seller's candid read of the account: what is really going on, where to push, and what would make this deal stall
}
${this.citationRule}`;

    return this.completeJSON(prompt, { maxTokens: 8000, label: 'value' });
  }

  /** Short natural-language read on why the account scored the way it did. */
  async summariseScore(context, score) {
    try {
      const prompt = `${context}

The prospect scored ${score.value}/100 on fit for this seller. Signal breakdown: ${JSON.stringify(score.breakdown)}.
Contributing observations: ${score.reasons.join('; ') || 'none'}.

Return JSON: {"summary": "two or three sentences, 45-60 words: what drove the score, what it means for prioritising this account, and the single move that would raise it"}`;

      const result = await this.completeJSON(prompt, { maxTokens: 600, label: 'score summary' });
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
