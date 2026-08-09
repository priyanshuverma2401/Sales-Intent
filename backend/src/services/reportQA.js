const aiEngine = require('./aiEngine');

/**
 * "Ask anything about this report".
 *
 * A rep reading a forty-section brief before a call does not want to scroll to
 * find whether the account has an open regulatory deadline - they want to ask.
 * So this answers questions against a report that has ALREADY been written, and
 * against nothing else: no fresh crawl, no model recall about the company, no
 * inference beyond what is on the page.
 *
 * That constraint is the whole design. A report is client-facing research whose
 * every figure was extracted from a primary source in code; an assistant that
 * quietly supplements it from training data would put unsourced claims in a
 * rep's mouth wearing the report's authority. If the answer is not in the
 * report, the honest reply is that it is not in the report.
 */

// How much of the stored report reaches the prompt. A fully populated report
// with forty sources serialises to roughly 25k characters, so this normally
// costs nothing; past the ceiling the tail is dropped and the model is told,
// which is better than a provider rejecting the request as too large.
const MAX_CONTEXT_CHARS = Number(process.env.REPORT_QA_CONTEXT_CHARS) || 28000;

// A question, not an essay. Anything longer is a pasted document, and pasted
// documents are exactly the outside context this endpoint refuses to reason on.
const MAX_QUESTION_CHARS = 500;

// Follow-ups are the point ("and which of those fits us?"), but only the recent
// ones carry meaning, and every turn kept is context spent on something other
// than the report itself.
const MAX_HISTORY_TURNS = 6;
const MAX_HISTORY_CHARS = 700;

const MAX_ANSWER_TOKENS = 800;

// --------------------------------------------------------------------------
// Serialising the report
//
// Sections come out in the order they appear on screen, so "the second
// challenge" means the same thing to the model as it does to the reader.
// --------------------------------------------------------------------------

function cites(citations) {
  const list = (citations || []).filter(n => Number.isFinite(n));
  return list.length ? ` [${list.join('][')}]` : '';
}

function bullet(text, citations) {
  const body = String(text || '').replace(/\s+/g, ' ').trim();
  return body ? `- ${body}${cites(citations)}` : '';
}

/** A titled list of insights. Empty sections are omitted rather than emitted
 *  as headings with nothing under them - a heading with no content reads to a
 *  model as "asked and answered: nothing", which is not the same as absent. */
function block(title, insights) {
  const lines = (insights || []).map(i => bullet(i?.text, i?.citations)).filter(Boolean);
  return lines.length ? `${title}:\n${lines.join('\n')}` : '';
}

function day(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function amount(value, currency) {
  const n = Number(value);
  if (!Number.isFinite(n) || !n) return '';
  const unit = currency ? `${currency} ` : '';
  if (Math.abs(n) >= 1e9) return `${unit}${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${unit}${(n / 1e6).toFixed(1)}M`;
  return `${unit}${n.toLocaleString('en-US')}`;
}

/** The cover: who this company is, and how the scoring model rated them. */
function factsSection(report) {
  const f = report.fastFacts || {};
  const score = report.score || {};

  const facts = [
    f.industry && `Industry: ${f.industry}`,
    f.headquarters && `Headquarters: ${f.headquarters}`,
    f.employees && `Employees: ${Number(f.employees).toLocaleString('en-US')}`,
    f.founded && `Founded: ${f.founded}`,
    f.website && `Website: ${f.website}`,
    report.ticker && `Ticker: ${report.ticker}`,
    amount(f.revenue, f.revenueCurrency) &&
      `Revenue: ${amount(f.revenue, f.revenueCurrency)}${f.revenueAsOf ? ` (FY${f.revenueAsOf})` : ''}`,
    amount(f.marketCap, 'USD') && `Market cap: ${amount(f.marketCap, 'USD')}`,
    f.description && `Description: ${String(f.description).replace(/\s+/g, ' ').trim()}`,
  ].filter(Boolean);

  const scoring = score.value
    ? [
        `Fit score: ${score.value}/100 (${score.band || 'unbanded'})`,
        score.summary && `Score summary: ${score.summary}`,
        score.reasons?.length && `Score reasons:\n${score.reasons.map(r => `- ${r}`).join('\n')}`,
      ].filter(Boolean)
    : [];

  return [facts.length && `THE COMPANY:\n${facts.join('\n')}`, scoring.length && scoring.join('\n')]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * The seller's own profile, frozen onto the report when it was written.
 *
 * Without this "how do we fit?" is unanswerable, and every "what should I say"
 * question gets a generic answer. With it the model knows which side of the
 * conversation the reader is on.
 */
function sellerSection(report) {
  const c = report.context || {};
  const lines = [
    c.sellerName && `The reader sells for: ${c.sellerName}`,
    c.sellerCapabilities?.length && `What they sell: ${c.sellerCapabilities.join(', ')}`,
    c.sellerValuePropositions?.length && `Their value propositions: ${c.sellerValuePropositions.join('; ')}`,
    c.priorityTopics?.length && `Topics they treat as HIGH priority: ${c.priorityTopics.join(', ')}`,
    c.topics?.length && `Other topics they monitor: ${c.topics.join(', ')}`,
    c.technologies?.length && `Technologies they care about: ${c.technologies.join(', ')}`,
    c.targetIndustries?.length && `Industries they target: ${c.targetIndustries.join(', ')}`,
    c.targetDepartments?.length && `Departments they sell into: ${c.targetDepartments.join(', ')}`,
  ].filter(Boolean);

  return lines.length ? `WHO IS ASKING (the seller's own profile):\n${lines.join('\n')}` : '';
}

/**
 * Verified records - extracted from primary sources in code, never authored by
 * a model. Labelled as such in the prompt so the assistant repeats these
 * figures exactly rather than rounding or restating them.
 */
function evidenceSection(evidence = {}) {
  const parts = [];

  if (evidence.strategicPrograms?.length) {
    parts.push(
      `Named strategic programmes:\n${evidence.strategicPrograms
        .map(p =>
          `- ${p.name}${p.announcedAt ? ` (announced ${day(p.announcedAt)})` : ''}` +
          `${p.headlineNumber ? ` — target: ${p.headlineNumber}` : ''}` +
          `${p.summary ? ` — ${p.summary}` : ''}${cites(p.citations)}`
        )
        .join('\n')}`
    );
  }

  if (evidence.regulatoryActions?.length) {
    parts.push(
      `Regulatory actions:\n${evidence.regulatoryActions
        .map(a =>
          `- ${a.regulator || 'Regulator'}${a.actionType ? ` ${a.actionType}` : ''}` +
          `${a.announcedAt ? ` (${day(a.announcedAt)})` : ''}${a.amount ? ` — ${a.amount}` : ''}` +
          `${a.detail ? ` — ${a.detail}` : ''}${cites(a.citations)}`
        )
        .join('\n')}`
    );
  }

  if (evidence.executiveMoves?.length) {
    parts.push(
      `Executive moves:\n${evidence.executiveMoves
        .map(m =>
          `- ${m.person}${m.role ? `, ${m.role}` : ''} — ${m.movement || 'moved'}` +
          `${m.counterparty ? ` (${m.counterparty})` : ''}${m.announcedAt ? `, ${day(m.announcedAt)}` : ''}` +
          `${cites(m.citations)}`
        )
        .join('\n')}`
    );
  }

  const r = evidence.latestResults;
  if (r && (r.period || r.summary || r.revenue || r.profit)) {
    parts.push(
      `Latest reported results:\n${[
        r.period && `- Period: ${r.period}${r.periodEndedAt ? ` (ended ${day(r.periodEndedAt)})` : ''}`,
        amount(r.revenue, r.currency) && `- Revenue: ${amount(r.revenue, r.currency)}`,
        amount(r.profit, r.currency) && `- Profit: ${amount(r.profit, r.currency)}`,
        Number.isFinite(r.eps) && `- EPS: ${r.eps}`,
        amount(r.buybackAmount, r.currency) && `- Buyback: ${amount(r.buybackAmount, r.currency)}`,
        r.buyback && `- Buyback: ${r.buyback}`,
        Number.isFinite(r.dividendPerShare) && `- Dividend per share: ${r.dividendPerShare}`,
        r.dividend && `- Dividend: ${r.dividend}`,
        r.summary && `- Summary: ${r.summary}`,
        r.filedAt && `- Filed: ${day(r.filedAt)}`,
      ]
        .filter(Boolean)
        .join('\n')}${cites(r.citations)}`
    );
  }

  const h = evidence.hiring;
  if (h && (h.totalRoles || h.summary)) {
    parts.push(
      `Hiring activity:\n${[
        h.totalRoles && `- Open roles: ${h.totalRoles}`,
        h.byFunction?.length && `- By function: ${h.byFunction.map(x => `${x.name} ${x.count}`).join(', ')}`,
        h.byLocation?.length && `- By location: ${h.byLocation.map(x => `${x.name} ${x.count}`).join(', ')}`,
        h.summary && `- ${h.summary}`,
      ]
        .filter(Boolean)
        .join('\n')}${cites(h.citations)}`
    );
  }

  if (evidence.patents?.length) {
    parts.push(
      `Patent filings:\n${evidence.patents
        .slice(0, 25)
        .map(p =>
          `- ${p.title}${p.patentNumber ? ` (${p.patentNumber})` : ''}` +
          `${p.filedAt ? ` — filed ${day(p.filedAt)}` : ''}` +
          `${p.grantedAt ? ` — granted ${day(p.grantedAt)}` : ''}` +
          `${!p.filedAt && !p.grantedAt && p.status ? ` — ${p.status}` : ''}${cites(p.citations)}`
        )
        .join('\n')}`
    );
  }

  if (evidence.contractAwards?.length) {
    parts.push(
      `Public-sector contract awards:\n${evidence.contractAwards
        .slice(0, 25)
        .map(a =>
          `- ${a.agency || 'Agency'}${amount(a.amount, 'USD') ? ` — ${amount(a.amount, 'USD')}` : ''}` +
          `${a.startedAt ? ` (from ${day(a.startedAt)})` : ''}${a.description ? ` — ${a.description}` : ''}` +
          `${cites(a.citations)}`
        )
        .join('\n')}`
    );
  }

  return parts.length
    ? `VERIFIED RECORDS (extracted from primary sources in code — repeat these figures exactly as written):\n\n${parts.join('\n\n')}`
    : '';
}

function newsSection(news) {
  if (!news?.length) return '';
  const lines = news.map(n =>
    `- ${n.title}${n.source ? ` (${n.source}` : ''}${n.publishedAt ? `${n.source ? ', ' : ' ('}${day(n.publishedAt)}` : ''}` +
    `${n.source || n.publishedAt ? ')' : ''}${n.summary ? ` — ${String(n.summary).replace(/\s+/g, ' ').trim()}` : ''}` +
    `${cites(n.citations)}`
  );
  return `Recent news:\n${lines.join('\n')}`;
}

function talkingPointsSection(points) {
  if (!points?.length) return '';
  const lines = points.map((p, i) =>
    [
      `${i + 1}. ${p.headline ? `${p.headline} — ` : ''}${String(p.text || '').replace(/\s+/g, ' ').trim()}${cites(p.citations)}`,
      p.question && `   Ask: ${p.question}`,
      p.proof && `   Proof: ${p.proof}`,
      p.objection && `   Likely pushback: ${p.objection}`,
    ]
      .filter(Boolean)
      .join('\n')
  );
  return `What to say on the call:\n${lines.join('\n')}`;
}

function sourcesSection(sources) {
  if (!sources?.length) return '';
  const lines = sources.map(s =>
    `[${s.index}] ${s.title || 'Untitled'}${s.source ? ` — ${s.source}` : ''}` +
    `${s.publishedAt ? ` (${day(s.publishedAt)})` : ''}${s.type ? ` — ${s.type}` : ''}`
  );
  return `SOURCES (the only citation numbers that exist for this report):\n${lines.join('\n')}`;
}

/** The whole report as prompt text, in the order it is read on screen. */
function buildContext(report) {
  const brief = report.executiveBrief || {};
  const research = report.research || {};
  const value = report.value || {};
  const whitespace = report.whitespace || {};

  const sections = [
    `REPORT: ${report.companyName}`,
    report.generatedAt && `Written: ${day(report.lastUpdatedAt || report.generatedAt)}`,
    report.coverage?.thin && `Coverage warning: ${report.coverage.warning || 'this report was written from thin evidence'}`,
    sellerSection(report),
    factsSection(report),
    evidenceSection(report.evidence),

    'WHAT YOU NEED TO KNOW',
    block('Key insights', brief.keyInsights),
    block('Opportunities', brief.opportunities),
    block('Challenges', brief.challenges),
    block('People updates', brief.peopleUpdates),
    newsSection(brief.topNews),
    talkingPointsSection(brief.talkingPoints),
    brief.executivePerspective?.length &&
      `Executive quotes:\n${brief.executivePerspective
        .map(q => `- "${q.quote}" — ${q.person || 'unattributed'}${q.title ? `, ${q.title}` : ''}${cites(q.citations)}`)
        .join('\n')}`,

    'THE FULL PICTURE',
    block('Company overview', research.companyOverview),
    block('People changes', research.keyPeopleChanges),
    block('Projects underway', research.keyProjects),
    block('What they want to become', research.aspirations),
    block('Their business goals', research.businessGoals),
    block('Research opportunities', research.opportunities),
    block('The bigger picture', research.macroPerspective),
    block('Recent announcements', research.recentPress),
    block('Revenue streams', research.businessModel?.revenueStreams),
    block('How they go to market', research.businessModel?.goToMarket),
    block('Who they sell to', research.businessModel?.idealCustomerProfile),
    block('Strategic initiatives', research.strategicInitiatives),
    block('Financials', research.financials),
    block('SWOT — strengths', research.swot?.strengths),
    block('SWOT — weaknesses', research.swot?.weaknesses),
    block('SWOT — opportunities', research.swot?.opportunities),
    block('SWOT — threats', research.swot?.threats),
    block('Whitespace — what the R&D and contract record points to', whitespace.insights),
    block('Whitespace — capability gaps it opens', whitespace.capabilityGaps),

    'YOUR PITCH',
    block('Why they should change', value.whyChange),
    block('Why they should act now', value.whyNow),
    block('Why they should choose you', value.whyYou),
    block('What they are trying to achieve', value.valuePyramid?.companyGoals),
    block('How they plan to get there', value.valuePyramid?.businessStrategy),
    block('What is getting in the way', value.valuePyramid?.challengesObstacles),
    block('Where you can help', value.valuePyramid?.valuePaths),
    value.valuePropositions?.length &&
      `Ready-made pitch lines:\n${value.valuePropositions
        .map(p => `- ${p.title}: ${String(p.body || '').replace(/\s+/g, ' ').trim()}${cites(p.citations)}`)
        .join('\n')}`,
    block('Ideas to test', value.hypotheses),
    block('Our point of view', value.pointOfView),

    sourcesSection(report.sources),
  ].filter(Boolean);

  const text = sections.join('\n\n');

  // Truncation is announced rather than silent: an assistant that has been
  // handed three quarters of a report must not answer "that is not in the
  // report" for something that was simply cut off.
  if (text.length <= MAX_CONTEXT_CHARS) return text;

  return (
    `${text.slice(0, MAX_CONTEXT_CHARS)}\n\n[The report was longer than fits here and has been cut off at this point. ` +
    `If a question is about something that would appear after this line, say the answer is further down the report ` +
    `rather than that the report does not cover it.]`
  );
}

// --------------------------------------------------------------------------
// Answering
// --------------------------------------------------------------------------

const SYSTEM = [
  'You answer questions about ONE sales-intelligence report that has already been written.',
  'The report you are given is your only source of truth.',
  'You never use outside knowledge about the company, never estimate a figure, and never guess.',
  'You write the way a colleague who has read the report would answer across a desk: direct, specific, and short.',
].join(' ');

function buildPrompt({ report, context, question, history }) {
  const turns = (history || []).length
    ? `\n=== EARLIER IN THIS CONVERSATION ===\n${history
        .map(h => `${h.role === 'assistant' ? 'You' : 'They'}: ${h.content}`)
        .join('\n')}\n`
    : '';

  return `=== THE REPORT ===
${context}
=== END OF REPORT ===
${turns}
The reader is looking at this report about ${report.companyName} and asks:

"${question}"

Answer it. Rules, in order of importance:

1. Use ONLY what is in the report above. If the report does not answer the question, say so plainly
   in one sentence and name the closest thing it does cover. Never fill the gap from your own knowledge
   of ${report.companyName}, and never present an inference as something the report says.
2. Cite with the source numbers already in the report, written as [4] or [4][9] immediately after the
   claim they support. Only ever cite numbers that appear in the SOURCES list. A claim that came from a
   part of the report carrying no citation is fine to state - just leave it uncited.
3. Figures, dates, names and programme names must be repeated exactly as the report has them.
4. Lead with the answer. No preamble, no "according to the report", no restating the question.
5. Two to five sentences, or up to five short "- " bullets when the answer is genuinely a list.
6. When the question is about what to do - what to say, who to approach, what to send, how they fit -
   build the answer out of the report's talking points, value propositions, why-now and where-you-can-help
   material, tied to the specific evidence that supports it.
7. Plain text. No markdown headings, no bold, no numbered sections.`;
}

/** Source numbers the answer actually leaned on, in first-mention order. */
function extractCitations(answer, sources = []) {
  const valid = new Set((sources || []).map(s => s.index));
  const found = [];

  for (const match of String(answer || '').matchAll(/\[(\d+)\]/g)) {
    const n = Number(match[1]);
    if (valid.has(n) && !found.includes(n)) found.push(n);
  }

  return found;
}

/** Trims a client-supplied thread down to what is safe and useful to replay. */
function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .filter(turn => turn && typeof turn.content === 'string' && turn.content.trim())
    .map(turn => ({
      role: turn.role === 'assistant' ? 'assistant' : 'user',
      content: turn.content.replace(/\s+/g, ' ').trim().slice(0, MAX_HISTORY_CHARS),
    }))
    .slice(-MAX_HISTORY_TURNS);
}

/**
 * Answers one question about one report.
 *
 * Throws with a `status` the route can pass straight through, so the reasons a
 * question cannot be answered - no AI configured, nothing asked, a report that
 * never finished - read as themselves rather than as a 500.
 */
async function ask({ report, question, history }) {
  const asked = String(question || '').replace(/\s+/g, ' ').trim();

  if (!asked) {
    const error = new Error('Ask a question first');
    error.status = 400;
    throw error;
  }

  if (asked.length > MAX_QUESTION_CHARS) {
    const error = new Error(
      `That question is ${asked.length} characters. Keep it under ${MAX_QUESTION_CHARS} — this answers questions about the report rather than reading pasted documents.`
    );
    error.status = 400;
    throw error;
  }

  if (!aiEngine.enabled) {
    const error = new Error(
      'No AI provider is configured on the server, so questions cannot be answered. Set AZURE_OPENAI_* (or GROQ_API_KEY / GEMINI_API_KEY).'
    );
    error.status = 503;
    throw error;
  }

  const context = buildContext(report);

  const answer = await aiEngine.complete(
    buildPrompt({ report, context, question: asked, history: normalizeHistory(history) }),
    { maxTokens: MAX_ANSWER_TOKENS, system: SYSTEM }
  );

  const text = String(answer || '').trim();

  if (!text) {
    const error = new Error('The AI returned an empty answer. Try asking again.');
    error.status = 502;
    throw error;
  }

  return {
    answer: text,
    citations: extractCitations(text, report.sources),
    model: aiEngine.lastModel,
  };
}

module.exports = { ask, buildContext, MAX_QUESTION_CHARS };
