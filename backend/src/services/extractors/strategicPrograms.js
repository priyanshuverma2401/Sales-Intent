const {
  articleText,
  mentionsCompany,
  companyTokens,
  announcedAt,
  headlineFigure,
  dedupeBy,
  byDateDesc,
} = require('./common');

/**
 * Named company programmes - the strongest trigger in the report.
 *
 * A competitor's brief opens with "May 2026 growth plan targeting 15% RoTE and
 * cutting 7,000 roles" and builds the whole pitch on it. That works because the
 * programme is the company's own word for what it is doing: it has a name, a
 * date, a number and an owner, so a rep can open with it and be believed.
 *
 * The name is never invented. Either the source called it something, or there
 * is no record - a programme this extractor made up a name for would be the
 * single most damaging thing the report could print.
 */

// A programme is announced with one of these nouns. Used both to find the
// candidate and to bound the name.
const PROGRAM_NOUNS =
  'plan|programme|program|strategy|initiative|transformation|restructuring|' +
  'overhaul|roadmap|blueprint|agenda|drive|push|review|framework|scheme';

const PATTERNS = [
  // "its Fit for Growth programme" / "the Simplify 2026 plan"
  {
    re: new RegExp(
      `\\b(?:its|the|their|a new|new)\\s+((?:[A-Z][\\w&'’-]*|\\d{4})(?:\\s+(?:[A-Z][\\w&'’-]*|for|to|of|and|\\d{4})){0,4})\\s+(${PROGRAM_NOUNS})\\b`
    ),
    name: 1,
    noun: 2,
  },
  // "unveils Project Bloom" / "launches Horizon 2030"
  {
    re: new RegExp(
      `\\b(?:unveil|launch|announce|set out|lay out|kick off|introduce)\\w*\\s+` +
      `(?:its|the|a|their)?\\s*((?:Project|Programme|Program|Plan|Operation|Vision|Horizon)\\s+[A-Z][\\w&'’-]*(?:\\s+[A-Z\\d][\\w&'’-]*){0,2})`
    ),
    name: 1,
  },
  // "May 2026 growth plan" / "2027 cost programme" - the theme is what names it
  {
    re: new RegExp(
      `\\b((?:[A-Z][\\w&'’-]*|\\d{4})(?:\\s+(?:[A-Za-z][\\w&'’-]*|\\d{4})){0,3}\\s+` +
      `(?:growth|cost|savings|efficiency|transformation|restructuring|turnaround|productivity|simplification)\\s+` +
      `(?:${PROGRAM_NOUNS}))\\b`
    ),
    name: 1,
  },

  // "a $1.5bn cost-savings programme" - unnamed but numbered, still a programme
  {
    re: new RegExp(
      `\\b((?:[$£€¥]\\s?\\d[\\d,.]*\\s?(?:billion|bn|million|mn|trillion|tn)|\\d{4})[\\w\\s-]{0,25}?)\\s+(?:cost|savings|efficiency|growth|transformation|restructuring)[\\s-]*(${PROGRAM_NOUNS})\\b`,
      'i'
    ),
    name: 1,
    noun: 2,
    generic: true,
  },
];

// Cheap pre-filter, so the expensive patterns only run on plausible articles
const TRIGGER = new RegExp(
  `\\b(?:${PROGRAM_NOUNS}|investor day|capital markets day|savings target|cost target|` +
  `restructur\\w+|transformation|turnaround|efficiency drive)\\b`,
  'i'
);

// Words that mean the match is a phrase, not a name somebody chose
const NOT_A_PROGRAM_NAME = new Set([
  'the', 'its', 'their', 'this', 'that', 'new', 'business', 'company', 'group',
  'current', 'ongoing', 'existing', 'same', 'latest', 'annual', 'quarterly',
  'strategic', 'overall', 'broader', 'wider', 'similar', 'previous', 'original',
]);

/**
 * A programme name has to look chosen rather than described.
 *
 * "Fit for Growth" is a name. "the cost programme" is a description of one, and
 * printing it as though the company called it that is a small fabrication.
 */
function validName(candidate, { generic = false, tokens = new Set() } = {}) {
  let value = String(candidate || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';

  // "HSBC Fit for Growth programme" is the company plus the name; the company
  // is already the subject of the report and does not belong in the name
  let words = value.split(/\s+/);
  while (words.length > 1 && tokens.has(words[0].toLowerCase().replace(/[^a-z0-9]/g, ''))) {
    words = words.slice(1);
  }
  value = words.join(' ');

  if (value.length < 3 || value.length > 60) return '';
  if (words.length > 6) return '';

  const lower = words.map(w => w.toLowerCase().replace(/[^a-z0-9]/g, ''));
  if (lower.every(w => NOT_A_PROGRAM_NAME.has(w) || !w)) return '';
  // A leading filler word survived the pattern's own guard
  if (NOT_A_PROGRAM_NAME.has(lower[0]) && words.length < 3) return '';

  // A real name carries a capital or a year somewhere. The numbered-programme
  // pattern is exempt: "$1.5bn cost" is the identifier there.
  if (!generic && !/[A-Z]/.test(value) && !/\d{4}/.test(value)) return '';

  return value;
}

/** The sentence the programme was named in, for the report's summary line. */
function contextSentence(text, name) {
  const at = text.indexOf(name);
  if (at === -1) return '';

  const start = Math.max(0, text.lastIndexOf('.', at) + 1);
  const end = text.indexOf('.', at + name.length);

  return text
    .slice(start, end === -1 ? text.length : end + 1)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 260);
}

/**
 * @param {object[]} articles from the shared crawl
 * @param {object} company
 * @returns {object[]} programme records, newest first
 */
function extract(articles = [], company = {}) {
  const tokens = companyTokens(company);
  const records = [];

  for (const article of articles) {
    if (!article?.title) continue;

    const text = articleText(article);
    if (!TRIGGER.test(text)) continue;
    if (!mentionsCompany(article, company)) continue;

    const date = announcedAt(article);
    if (!date) continue;

    for (const pattern of PATTERNS) {
      const match = text.match(pattern.re);
      if (!match) continue;

      const raw = pattern.noun && pattern.generic
        ? `${match[pattern.name]} ${match[pattern.noun]}`.trim()
        : match[pattern.name];

      const name = validName(raw, { generic: pattern.generic, tokens });
      if (!name) continue;

      // The company's own word for it reads better with the noun attached:
      // "Fit for Growth" -> "Fit for Growth programme"
      const noun = pattern.noun && !pattern.generic ? match[pattern.noun] : '';
      const fullName = noun && !new RegExp(`\\b${noun}\\b`, 'i').test(name)
        ? `${name} ${noun.toLowerCase()}`
        : name;

      records.push({
        name: fullName,
        announcedAt: date,
        headlineNumber: headlineFigure(text),
        summary: contextSentence(text, name) || article.title,
        url: article.url,
        source: article.publisher || 'News',
        citations: [],
        _article: article,
      });

      break;
    }
  }

  // One record per programme. The best copy is the one carrying a figure -
  // "targets 15% RoTE" is what makes the programme quotable in a meeting.
  const unique = dedupeBy(
    records,
    record => record.name.toLowerCase().replace(/[^a-z0-9]/g, ''),
    (candidate, existing) => {
      const weight = r => (r.headlineNumber ? 2 : 0) + (r.summary?.length > 80 ? 1 : 0);
      return weight(candidate) > weight(existing);
    }
  );

  return unique.sort(byDateDesc);
}

/** "Fit for Growth programme — 15% RoTE by 2028 (May 2026)" */
function format(record) {
  if (!record?.name) return '';

  const date = record.announcedAt
    ? new Date(record.announcedAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '';

  const parts = [record.headlineNumber, date].filter(Boolean).join(', ');
  return parts ? `${record.name} — ${parts}` : record.name;
}

module.exports = { extract, format };
