// Salesmotion score: how well a prospect matches THIS seller right now.
// Deliberately transparent arithmetic rather than an AI guess, so the number is
// stable between runs and the reasons can be shown to the user.

const BASE_WEIGHTS = {
  keywordFit: 35,       // does their public activity match the topics we monitor
  buyingSignals: 20,    // earnings/M&A/funding/executive events
  hiringSignals: 20,    // are they hiring into the departments we sell to
  newsMomentum: 15,     // is anything happening at all, recently
  financialContext: 10, // can they fund it
};

// When the tenant's CRM knows this account, what they already have with it
// outranks anything inferred from the public web - so the public components are
// scaled back to make room rather than the total being inflated past 100.
const CRM_WEIGHTS = {
  keywordFit: 30,
  buyingSignals: 18,
  hiringSignals: 15,
  newsMomentum: 12,
  financialContext: 10,
  crmSignals: 15,       // open pipeline, engagement recency, relationship depth
};

const BUYING_SIGNAL_WORDS = [
  'earnings', 'results', 'acquisition', 'acquires', 'merger', 'funding', 'raises',
  'investment', 'partnership', 'transformation', 'modernisation', 'modernization',
  'restructuring', 'cost savings', 'appointed', 'named chief', 'new ceo', 'new cfo',
  'new cio', 'rollout', 'launch', 'expansion', 'contract', 'rfp', 'outsourcing',
];

function normalise(value) {
  return String(value || '').toLowerCase();
}

// "GenAI solutions" should still match "gen ai" and "generative ai"
function keywordVariants(keyword) {
  const base = normalise(keyword).replace(/\s+solutions?$/, '').trim();
  const variants = new Set([base]);

  variants.add(base.replace(/\s+/g, ''));
  if (base.includes('genai') || base.includes('gen ai')) {
    variants.add('generative ai');
    variants.add('gen ai');
    variants.add('genai');
  }
  if (base.includes('ai')) variants.add('artificial intelligence');
  if (base.includes('copilot')) variants.add('co-pilot');

  return Array.from(variants).filter(v => v.length >= 3);
}

function countMatches(haystack, keywords) {
  const hits = new Map();

  keywords.forEach(keyword => {
    const variants = keywordVariants(keyword);
    const count = variants.reduce((total, variant) => {
      const matches = haystack.split(variant).length - 1;
      return total + matches;
    }, 0);
    if (count > 0) hits.set(keyword, count);
  });

  return hits;
}

function daysSince(date) {
  if (!date) return Infinity;
  const then = new Date(date).getTime();
  if (Number.isNaN(then)) return Infinity;
  return (Date.now() - then) / 86400000;
}

function clamp(value, max) {
  return Math.max(0, Math.min(max, value));
}

/**
 * The CRM half of the score. Three things move it: money already in play, how
 * recently anyone spoke to them, and how deep the relationship goes.
 * Returns { points, reasons } against CRM_WEIGHTS.crmSignals.
 */
function scoreCrm(crm, weight) {
  const reasons = [];
  let points = 0;

  const open = crm.openOpportunities || [];
  const pipeline = crm.openPipeline || 0;

  if (open.length) {
    points += Math.min(open.length * 2, 5);
    points += pipeline >= 1e6 ? 4 : pipeline >= 1e5 ? 3 : pipeline > 0 ? 1.5 : 0;

    const nearest = open
      .map(o => o.closeDate)
      .filter(Boolean)
      .sort((a, b) => new Date(a) - new Date(b))[0];

    reasons.push(
      `${open.length} open ${open.length === 1 ? 'deal' : 'deals'} in your CRM` +
        (pipeline ? ` worth ${Math.round(pipeline).toLocaleString()}` : '') +
        (nearest ? `, next close ${new Date(nearest).toISOString().slice(0, 10)}` : '')
    );
  }

  if (crm.wonOpportunities?.length) {
    points += 2.5;
    reasons.push(`Existing customer — ${crm.wonOpportunities.length} closed-won deal(s) on record`);
  } else if (crm.account?.type) {
    reasons.push(`CRM account type: ${crm.account.type}`);
  }

  // Recency cuts both ways: a live conversation is worth points, a cold account
  // with open pipeline is exactly the account a rep should be told about.
  const days = crm.lastActivityAt ? daysSince(crm.lastActivityAt) : Infinity;
  if (days <= 14) {
    points += 3;
    reasons.push(`Active in the CRM in the last ${Math.max(1, Math.round(days))} days`);
  } else if (days <= 60) {
    points += 1.5;
  } else if (Number.isFinite(days) && open.length) {
    reasons.push(`No CRM activity for ${Math.round(days)} days despite open pipeline`);
  }

  if ((crm.contacts?.length || 0) >= 3) {
    points += 1.5;
    reasons.push(`${crm.contacts.length} contacts mapped in the CRM`);
  }

  return { points: clamp(points, weight), reasons };
}

// A high-priority topic counts for twice as much as a standard one, in both
// coverage and density. Without this an account matching three incidental
// topics would outrank one matching the single subject the company cares about.
const PRIORITY_WEIGHT = { high: 2, normal: 1 };

/**
 * @param {object} input
 * @param {object} input.company    prospect record
 * @param {Array}  input.news       normalised news articles
 * @param {Array}  input.jobs       open positions
 * @param {object} input.seller     organization.toSellerContext() - the only lens
 * @param {object} [input.crm]      CrmRecord.toContext(), when a CRM is connected
 */
function scoreAccount({ company = {}, news = [], jobs = [], seller = {}, crm = null }) {
  const reasons = [];
  // Every component below is capped against this set, so connecting a CRM
  // rebalances the score rather than adding a sixth component on top of 100.
  const WEIGHTS = crm?.matched !== false && crm ? CRM_WEIGHTS : BASE_WEIGHTS;

  const topics = (seller.topics || []).filter(t => t?.name);
  const capabilities = [
    ...(seller.capabilities || []),
    ...(seller.relevantTechnologies || []),
  ].filter(Boolean);

  const newsText = normalise(news.map(n => `${n.title} ${n.description || ''}`).join(' '));
  const jobsText = normalise(jobs.map(j => `${j.title || ''} ${j.description || ''} ${j.department || ''}`).join(' '));
  const profileText = normalise(`${company.description || ''} ${company.industry || ''}`);
  const allText = `${newsText} ${jobsText} ${profileText}`;

  // --- 1. Topic fit --------------------------------------------------------
  // Coverage and density are both weighted by topic priority, so the score
  // answers "does this account move on the subjects we actually care about?"
  let keywordFit = 0;
  if (topics.length === 0) {
    // No topics configured: award a neutral middle score rather than punishing
    keywordFit = WEIGHTS.keywordFit * 0.5;
    reasons.push('No relevant topics configured on the company profile — score is based on general signals only');
  } else {
    const hits = countMatches(allText, topics.map(t => t.name));
    const weightOf = name =>
      PRIORITY_WEIGHT[topics.find(t => t.name === name)?.priority] || PRIORITY_WEIGHT.normal;

    const totalWeight = topics.reduce((sum, t) => sum + (PRIORITY_WEIGHT[t.priority] || 1), 0);
    const matchedWeight = Array.from(hits.keys()).reduce((sum, name) => sum + weightOf(name), 0);
    const density = Array.from(hits.entries())
      .reduce((sum, [name, count]) => sum + count * weightOf(name), 0);

    const coverage = totalWeight ? matchedWeight / totalWeight : 0;

    keywordFit = clamp(
      WEIGHTS.keywordFit * (coverage * 0.7 + Math.min(density / 12, 1) * 0.3),
      WEIGHTS.keywordFit
    );

    if (hits.size) {
      // High-priority matches are named first: they are the reason to act
      const matched = Array.from(hits.keys()).sort((a, b) => weightOf(b) - weightOf(a));
      const priorityMatched = matched.filter(name => weightOf(name) > 1);

      reasons.push(
        `Public activity mentions ${matched.join(', ')} (${density} weighted reference${density === 1 ? '' : 's'})` +
          (priorityMatched.length ? ` — including high-priority ${priorityMatched.join(', ')}` : '')
      );
    } else {
      reasons.push(
        `No public mention of ${topics.map(t => t.name).join(', ')} yet — this is a create-the-need play`
      );
    }
  }

  // Capability and technology adjacency tops up the score when the monitored
  // topics themselves are absent from the public record
  const capabilityHits = countMatches(allText, capabilities);
  if (capabilityHits.size) {
    keywordFit = clamp(keywordFit + Math.min(capabilityHits.size * 1.5, 6), WEIGHTS.keywordFit);
    reasons.push(`Adjacent demand visible for ${Array.from(capabilityHits.keys()).slice(0, 3).join(', ')}`);
  }

  // --- 2. Buying signals ---------------------------------------------------
  const buyingHits = news.filter(n => {
    const text = normalise(`${n.title} ${n.description || ''}`);
    return BUYING_SIGNAL_WORDS.some(word => text.includes(word));
  });
  const buyingSignals = clamp(buyingHits.length * 3.5, WEIGHTS.buyingSignals);
  if (buyingHits.length) {
    reasons.push(`${buyingHits.length} buying-trigger event${buyingHits.length === 1 ? '' : 's'} in recent news`);
  }

  // --- 3. Hiring signals ---------------------------------------------------
  const departments = (seller.targetDepartments || []).filter(Boolean);
  // Flattened as "Director (AI, Automation)" for the prompt; only the title
  // itself is worth matching a job posting against.
  const hiringTitles = (seller.relevantHiringTitles || [])
    .map(t => String(t).split(' (')[0].trim())
    .filter(Boolean);
  const wanted = [...departments, ...hiringTitles];

  let hiringSignals = 0;
  if (jobs.length) {
    const targeted = wanted.length
      ? jobs.filter(j => {
          const text = normalise(`${j.title || ''} ${j.department || ''}`);
          return wanted.some(d => text.includes(normalise(d)));
        })
      : [];

    hiringSignals = clamp(
      Math.min(jobs.length, 10) * 1.2 + targeted.length * 2.5,
      WEIGHTS.hiringSignals
    );

    reasons.push(
      targeted.length
        ? `Hiring ${targeted.length} role${targeted.length === 1 ? '' : 's'} in the departments and titles you track`
        : `${jobs.length} open role${jobs.length === 1 ? '' : 's'} detected`
    );
  }

  // --- 4. News momentum ----------------------------------------------------
  const fresh = news.filter(n => daysSince(n.publishedAt) <= 30);
  const recent = news.filter(n => daysSince(n.publishedAt) <= 90);
  const newsMomentum = clamp(fresh.length * 1.8 + recent.length * 0.6, WEIGHTS.newsMomentum);
  if (fresh.length) {
    reasons.push(`${fresh.length} article${fresh.length === 1 ? '' : 's'} published in the last 30 days`);
  }

  // --- 5. Financial context ------------------------------------------------
  let financialContext = 0;
  const marketCap = company.financials?.marketCap || company.stock?.marketCap;
  const growth = company.financials?.revenueGrowth;

  if (marketCap) {
    financialContext += marketCap >= 1e10 ? 6 : marketCap >= 1e9 ? 4 : 2;
  }
  if (typeof growth === 'number') {
    financialContext += growth > 0 ? 4 : 1;
    reasons.push(`Revenue growth ${growth > 0 ? 'positive' : 'flat/negative'} at ${growth}%`);
  }
  if (company.employees >= 10000) financialContext += 2;
  financialContext = clamp(financialContext, WEIGHTS.financialContext);

  // --- 6. CRM signals (only when a CRM is connected and matched) -----------
  let crmSignals = 0;
  if (WEIGHTS.crmSignals) {
    const scored = scoreCrm(crm, WEIGHTS.crmSignals);
    crmSignals = scored.points;
    // Put the CRM reasons first: they are the ones the rep can act on today
    reasons.unshift(...scored.reasons);
  }

  const breakdown = {
    keywordFit: Math.round(keywordFit),
    buyingSignals: Math.round(buyingSignals),
    hiringSignals: Math.round(hiringSignals),
    newsMomentum: Math.round(newsMomentum),
    financialContext: Math.round(financialContext),
    ...(WEIGHTS.crmSignals ? { crmSignals: Math.round(crmSignals) } : {}),
  };

  const value = Math.max(
    1,
    Math.min(100, Object.values(breakdown).reduce((a, b) => a + b, 0))
  );

  const band =
    value >= 80 ? 'Priority' :
    value >= 60 ? 'Strong' :
    value >= 40 ? 'Developing' :
    'Watch';

  return { value, band, breakdown, reasons: reasons.slice(0, 6), weights: WEIGHTS };
}

module.exports = { scoreAccount, WEIGHTS: BASE_WEIGHTS, CRM_WEIGHTS };
