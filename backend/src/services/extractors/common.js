/**
 * Shared parsing for the record extractors.
 *
 * Every figure and name the report states as fact is pulled out here, in code,
 * from text a source actually published. Nothing in this directory asks a model
 * for a fact: a model that is unsure produces a plausible name, and a plausible
 * name in a client-facing brief is worse than an empty section.
 *
 * The bias throughout is toward dropping records. A half-record - a person with
 * no date, a programme with no name - is not evidence, and the sections that
 * render these are all allowed to be empty.
 */

// Capitalised words that begin a headline or a company name and would otherwise
// be read as somebody's first name.
const NOT_A_NAME = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'for', 'with', 'from', 'into', 'over',
  // Connectors. Without these a run like "Christian Schwarz as" reads as a
  // three-word name, and the role ends up inside the person's field.
  'as', 'to', 'at', 'of', 'in', 'on', 'by', 'after', 'amid', 'has', 'have',
  'will', 'said', 'says', 'is', 'was', 'were', 'been', 'its', 'their', 'his',
  'her', 'who', 'that', 'this', 'it', 'up', 'out', 'off', 'down',
  'new', 'former', 'chief', 'head', 'group', 'global', 'senior', 'deputy',
  'president', 'director', 'officer', 'executive', 'vice', 'managing', 'general',
  'board', 'company', 'bank', 'holdings', 'group', 'plc', 'inc', 'corp', 'ltd',
  'limited', 'llc', 'sa', 'nv', 'ag', 'update', 'exclusive', 'breaking', 'report',
  'reports', 'analysis', 'opinion', 'why', 'how', 'what', 'when', 'who',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december', 'monday', 'tuesday',
  'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'q1', 'q2', 'q3', 'q4', 'fy', 'h1', 'h2',
]);

// Titles that confirm a capitalised run is a role rather than a person
const ROLE_WORDS = [
  'chief', 'head', 'director', 'president', 'officer', 'manager', 'lead',
  'partner', 'chair', 'chairman', 'chairwoman', 'ceo', 'cfo', 'cto', 'coo',
  'cio', 'ciso', 'cmo', 'chro', 'vp', 'evp', 'svp', 'principal', 'treasurer',
  'secretary', 'counsel', 'analyst', 'architect', 'engineer', 'scientist',
  // Board and committee appointments are senior moves too, and they are worded
  // as membership rather than as a title
  'member', 'trustee', 'governor',
];

/** Text of an article as one searchable string. */
function articleText(article = {}) {
  return `${article.title || ''}. ${article.description || ''}`.replace(/\s+/g, ' ').trim();
}

/**
 * Does this article actually name the company?
 *
 * A `site:` query or a broad feed will return stories about a competitor, and
 * an extractor with no company check will happily attribute a rival's new CFO
 * to the account being reported on.
 */
function mentionsCompany(article, company = {}) {
  const text = articleText(article).toLowerCase();
  if (!text) return false;

  return aliases(company).some(alias => text.includes(alias));
}

// Suffixes that appear on the legal name and never in a headline
const LEGAL_SUFFIX = /\b(inc|corp|corporation|ltd|limited|llc|plc|holdings|holding|group|company|co|sa|nv|ag|gmbh|kk|ab|oyj)\b/g;

/**
 * The names a headline might use for this company.
 *
 * Records are stored against the legal name - "HSBC Holdings", "Norwegian
 * Cruise Line Holdings" - and reported under the brand. Matching only on the
 * full legal name finds close to nothing, which is the whole reason a check
 * like this needs its own function rather than an inline `includes`.
 */
function aliases(company = {}) {
  const name = String(company.name || '').toLowerCase().trim();
  if (!name) return [];

  const stripped = name.replace(LEGAL_SUFFIX, ' ').replace(/\s+/g, ' ').trim();
  const lead = stripped.split(/\s+/)[0];
  const ticker = String(company.ticker || '').toLowerCase().trim();

  return [...new Set([
    name,
    stripped,
    // An acronym like "HSBC" is four characters and is the only name anyone
    // uses for it, so the floor is low enough to admit that and high enough to
    // stop "BP" matching every third word in an unrelated story
    lead && lead.length >= 4 ? lead : null,
    ticker && ticker.length >= 3 ? ticker : null,
  ].filter(Boolean))];
}

/** Words a company name is built from, for telling people apart from employers. */
function companyTokens(company = {}) {
  return new Set(
    String(company.name || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2)
  );
}

/**
 * Is this capitalised run a person's name?
 *
 * Two or three capitalised words, none of which is a company word, a role word,
 * a month or a headline opener. Deliberately strict - it is the gate that keeps
 * "Deutsche Bank" and "New York" out of the People Updates section.
 */
function looksLikePerson(candidate, tokens = new Set()) {
  const value = String(candidate || '').trim();
  if (!value) return false;

  const words = value.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;

  for (const word of words) {
    // A possessive is somebody else's name attached to this one - "JPMorgan's
    // Willis" is a hire FROM JPMorgan, and printing the pair as the person's
    // name in a client-facing brief is worse than not printing the move at all
    if (/['’]s$/.test(word)) return false;

    const lower = word.toLowerCase().replace(/[^a-z]/g, '');
    if (!lower) return false;
    if (NOT_A_NAME.has(lower)) return false;
    if (ROLE_WORDS.includes(lower)) return false;
    if (tokens.has(lower)) return false;
    // Initials and particles are fine; anything else must be capitalised
    if (word.length > 2 && !/^[A-Z]/.test(word)) return false;
  }

  // An all-caps run is an acronym or a shouted headline, not a name
  if (value === value.toUpperCase()) return false;

  return true;
}

/**
 * A role title looks like a role: it contains a role word, and it stops before
 * the sentence turns into something else.
 */
function cleanRole(candidate) {
  let value = String(candidate || '')
    .replace(/\s+/g, ' ')
    .trim();

  // Qualifiers a headline puts in front of the title. "first Chief AI Officer"
  // is a fact about the role's history, not part of its name.
  value = value.replace(/^(?:the|a|an|its|their|our|new|as|first|interim|acting|incoming|outgoing|next)\s+/i, '').trim();

  // Cut at the first clause boundary. A newsroom headline runs several segments
  // into one line - "…Chief AI Officer | Media releases | HSBC Holdings plc" -
  // and only the first belongs in this field.
  // "chairman to replace Mark Tucker" is a role plus who it was taken over
  // from; only the first half is the title
  value = value.split(
    /[,;:|]|\s+[-–—]\s+|\s+(?:effective|starting|beginning|with effect|as of|from|at|to replace|replacing|succeeding|after)\s+/i
  )[0].trim();
  value = value.replace(/[.!?]+$/, '').trim();

  if (value.length < 3 || value.length > 80) return '';
  if (!ROLE_WORDS.some(word => value.toLowerCase().includes(word))) return '';

  return value;
}

/**
 * The announcement date.
 *
 * The article's publication date is the date the move or programme became
 * public, which is the date the report should show. An article with no date
 * cannot support a dated claim, so its records are dropped.
 */
function announcedAt(article = {}) {
  if (!article.publishedAt) return null;
  const date = new Date(article.publishedAt);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "May 2026" - how every dated record reads in the report. */
function monthYear(date) {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * Money and percentages exactly as the source wrote them.
 *
 * Returned as the source's own string rather than a parsed number: "$1.5bn" and
 * "15% RoTE by 2028" both carry units and a timeframe that a float would lose,
 * and the report quotes them rather than doing arithmetic on them.
 */
function headlineFigure(text) {
  const value = String(text || '');

  const patterns = [
    // $1.5 billion / £800m / €2bn
    /(?:[$£€¥]\s?\d[\d,.]*\s?(?:billion|bn|million|mn|m|trillion|tn|k)\b)/i,
    // 15% RoTE by 2028. Tried before the open-ended form below, because the
    // year a target is set against is the half of it that creates urgency.
    /\d{1,3}(?:\.\d+)?%\s+[A-Za-z][\w-]*(?:\s+[A-Za-z][\w-]*){0,3}\s+by\s+(?:\d{4}|FY\s?\d{2,4})/,
    // 12% return on tangible equity
    /\d{1,3}(?:\.\d+)?%\s+[A-Za-z][\w-]*(?:\s+[A-Za-z][\w-]*){0,3}/,
    // 7,000 roles / 3,500 jobs
    /(?:\d[\d,]{2,}\s+(?:roles|jobs|positions|staff|employees|headcount))/i,
    // 1.5 billion in savings
    /(?:\d[\d,.]*\s?(?:billion|bn|million|mn|trillion)\b[^.]{0,30}?(?:saving|cost|cut|invest)\w*)/i,
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) return trimConnectors(match[0]);
  }

  return '';
}

// A greedy match can end on "by", "of" or "and", which reads as a figure that
// was cut off mid-sentence. Those are shaved off the tail.
const TRAILING = /\s+(?:by|of|in|on|to|and|the|a|an|for|with|from|at)$/i;

function trimConnectors(value) {
  let result = String(value).replace(/\s+/g, ' ').trim();
  while (TRAILING.test(result)) result = result.replace(TRAILING, '');
  return result;
}

/** One record per real-world thing, keeping the best-sourced copy of each. */
function dedupeBy(records, keyOf, betterThan) {
  const byKey = new Map();

  for (const record of records) {
    const key = keyOf(record);
    if (!key) continue;

    const existing = byKey.get(key);
    if (!existing || betterThan(record, existing)) byKey.set(key, record);
  }

  return [...byKey.values()];
}

/** Newest first - what every one of these sections is sorted by. */
function byDateDesc(a, b) {
  return new Date(b.announcedAt || b.filedAt || 0) - new Date(a.announcedAt || a.filedAt || 0);
}

module.exports = {
  articleText,
  mentionsCompany,
  aliases,
  companyTokens,
  looksLikePerson,
  cleanRole,
  announcedAt,
  monthYear,
  headlineFigure,
  dedupeBy,
  byDateDesc,
  ROLE_WORDS,
  NOT_A_NAME,
};
