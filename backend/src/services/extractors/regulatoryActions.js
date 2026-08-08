const {
  articleText,
  mentionsCompany,
  announcedAt,
  headlineFigure,
  dedupeBy,
  byDateDesc,
} = require('./common');

/**
 * Regulatory action as a trigger type.
 *
 * Regulation creates obligation rather than opportunity, which is what makes it
 * a stronger buying trigger than most M&A: a bank that must answer a supervisor
 * by a date has budget with a deadline attached, and no choice about spending it.
 *
 * Only accounts tagged as regulated reach this - see accountTagging. On a
 * retailer or a SaaS company these patterns match nothing, and the regulator
 * feeds that supply them were never queried in the first place.
 */

// Regulators the crawl can surface, keyed by the words that name them in copy.
// The `host` is how accountTagging queried them, so a story that came back from
// that feed can be attributed even when the body only says "the regulator".
const REGULATORS = [
  { match: ['financial conduct authority', 'the fca', 'fca '], name: 'Financial Conduct Authority' },
  { match: ['bank of england', 'prudential regulation authority', 'the pra'], name: 'Bank of England / PRA' },
  { match: ['bafin'], name: 'BaFin' },
  { match: ['austrac'], name: 'AUSTRAC' },
  { match: ['fdic'], name: 'FDIC' },
  { match: ['federal reserve', 'the fed '], name: 'Federal Reserve' },
  { match: ['occ ', 'comptroller of the currency'], name: 'OCC' },
  { match: ['sec ', 'securities and exchange commission'], name: 'SEC' },
  { match: ['naic', 'insurance commissioners'], name: 'NAIC' },
  { match: ['ofgem'], name: 'Ofgem' },
  { match: ['ofwat'], name: 'Ofwat' },
  { match: ['australian energy regulator'], name: 'Australian Energy Regulator' },
  { match: ['acsc', 'australian cyber security centre'], name: 'Australian Cyber Security Centre' },
  { match: ['cert nz'], name: 'CERT NZ' },
  { match: ['cdc ', 'centers for disease control'], name: 'CDC' },
  { match: ['fda '], name: 'FDA' },
  { match: ['european central bank', 'the ecb'], name: 'European Central Bank' },
  { match: ['mas ', 'monetary authority of singapore'], name: 'Monetary Authority of Singapore' },
  { match: ['rbi ', 'reserve bank of india'], name: 'Reserve Bank of India' },
  { match: ['apra'], name: 'APRA' },
  { match: ['finma'], name: 'FINMA' },
];

// What the regulator did. Ordered by how hard the deadline is: a fine is a
// settled fact, an advisory is a warning, and they are not the same trigger.
const ACTIONS = [
  { type: 'fine', words: ['fined', 'fines', 'fine of', 'penalty', 'penalties', 'penalised', 'penalized', 'sanctioned', 'settlement with'] },
  { type: 'enforcement', words: ['enforcement action', 'censured', 'prosecut', 'charges against', 'banned', 'ordered to'] },
  { type: 'licence', words: ['licence', 'license revoked', 'authorisation', 'authorization withdrawn', 'permit'] },
  { type: 'stress-test', words: ['stress test', 'capital requirement', 'buffer requirement', 'solvency requirement'] },
  { type: 'deadline', words: ['deadline', 'must comply', 'by the end of', 'compliance date', 'comes into force', 'takes effect'] },
  { type: 'advisory', words: ['advisory', 'guidance', 'warning', 'consultation', 'discussion paper', 'review of', 'probe', 'investigat'] },
];

const TRIGGER = /\b(regulat\w+|supervis\w+|complian\w+|fined?|penalt\w+|enforcement|sanction\w*|advisory|guidance|consultation|stress test|licen[cs]e|antitrust|investigat\w+|probe|watchdog|authority)\b/i;

function findRegulator(text, article) {
  const lower = ` ${text.toLowerCase()} `;

  for (const regulator of REGULATORS) {
    if (regulator.match.some(term => lower.includes(term))) return regulator.name;
  }

  // The crawl knows which regulator feed returned this even when the body only
  // says "the regulator"
  return article?.regulator || '';
}

function findAction(text) {
  const lower = text.toLowerCase();

  for (const action of ACTIONS) {
    if (action.words.some(word => lower.includes(word))) return action.type;
  }
  return '';
}

/** The sentence carrying the action, trimmed to something quotable. */
function detailLine(text, article) {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const lower = ACTIONS.flatMap(a => a.words);

  const hit = sentences.find(s => {
    const value = s.toLowerCase();
    return lower.some(word => value.includes(word));
  });

  return (hit || article.title || '').replace(/\s+/g, ' ').trim().slice(0, 280);
}

/**
 * @param {object[]} articles from the shared crawl
 * @param {object} company  must be tagged regulated, or this returns []
 * @returns {object[]} regulatory records, newest first
 */
function extract(articles = [], company = {}) {
  // The gate. A generic SaaS or retail account never runs this - these sources
  // return nothing relevant and a false positive here is expensive.
  if (!company.tags?.regulated) return [];

  const records = [];

  for (const article of articles) {
    if (!article?.title) continue;

    const text = articleText(article);
    if (!TRIGGER.test(text)) continue;
    if (!mentionsCompany(article, company)) continue;

    const date = announcedAt(article);
    if (!date) continue;

    const regulator = findRegulator(text, article);
    const actionType = findAction(text);

    // Both or nothing: "a regulator did something" is not a record a rep can
    // open a conversation with, and neither is "somebody was fined"
    if (!regulator || !actionType) continue;

    records.push({
      regulator,
      actionType,
      announcedAt: date,
      detail: detailLine(text, article),
      // A penalty figure belongs in the detail line where it exists
      amount: headlineFigure(text),
      url: article.url,
      source: article.publisher || 'News',
      citations: [],
      _article: article,
    });
  }

  const unique = dedupeBy(
    records,
    record => `${record.regulator.toLowerCase()}|${record.actionType}|${new Date(record.announcedAt).toISOString().slice(0, 7)}`,
    (candidate, existing) => (candidate.detail?.length || 0) > (existing.detail?.length || 0)
  );

  return unique.sort(byDateDesc);
}

const ACTION_LABELS = {
  fine: 'Fine',
  enforcement: 'Enforcement action',
  licence: 'Licence action',
  'stress-test': 'Capital / stress-test requirement',
  deadline: 'Compliance deadline',
  advisory: 'Advisory',
};

/** "Financial Conduct Authority — Advisory (May 2026)" */
function format(record) {
  if (!record?.regulator) return '';

  const date = record.announcedAt
    ? new Date(record.announcedAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '';

  const label = ACTION_LABELS[record.actionType] || record.actionType;
  return `${record.regulator} — ${label}${date ? ` (${date})` : ''}`;
}

module.exports = { extract, format, ACTION_LABELS };
