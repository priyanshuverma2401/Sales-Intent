const {
  articleText,
  mentionsCompany,
  companyTokens,
  looksLikePerson,
  cleanRole,
  announcedAt,
  dedupeBy,
  byDateDesc,
} = require('./common');

/**
 * Who joined, who left, who was promoted.
 *
 * The report used to say "no specific executives mentioned", which reads as a
 * product that cannot find anything rather than an account where nothing
 * happened. The fix is not a softer sentence - it is actually finding the
 * moves, and saying plainly when there were none.
 *
 * A record needs a name and a date or it is thrown away. Half a record is not
 * evidence: "an executive was appointed in the risk function" tells a rep
 * nothing they can open a call with, and it cannot be checked.
 *
 * The parse is anchored on the verb rather than run as one large pattern.
 * "HSBC CFO Georges Elhedery steps down" defeats a single regex - the leftmost
 * capitalised run is "HSBC CFO Georges Elhedery" and a pattern that captures it
 * finds no valid person and gives up, losing a move that is plainly there. So
 * the verb is located first and the name grown outward from it, shortest valid
 * run winning.
 */

// Where the person sits relative to the verb, and where the role sits.
// `after` means "X appoints JANE DOE as head of risk"; `before` means
// "JANE DOE joins as head of risk".
const ANCHORS = [
  // Active and passive read in opposite directions - "HSBC appoints Jane Doe"
  // puts the name after the verb, "Jane Doe was appointed" puts it before -
  // and both are common in the same feed. `either` tries after, then before.
  { re: /\b(?:appoints?|appointed|names?|named|hires?|hired|taps|tapped)\b/gi, person: 'either', movement: 'joined' },
  // "HSBC announces David Rice as its first Chief AI Officer" - how a company's
  // own newsroom words it, which is where senior hires appear first
  { re: /\b(?:announces?|announced|confirms?|confirmed|welcomes?|welcomed)\s+(?:the\s+appointment\s+of\s+)?/gi, person: 'after', movement: 'joined' },
  { re: /\bappointment\s+of\s+/gi, person: 'after', movement: 'joined' },
  { re: /\b(?:promotes?|promoted|elevates?|elevated)\b/gi, person: 'after', movement: 'promoted' },
  { re: /\b(?:joins|joined|is joining|to join|has joined|will join)\b/gi, person: 'before', movement: 'joined' },
  { re: /\b(?:steps? down|stepping down|resigns?|resigned|departs?|departed|to leave|is leaving|exits?|retires?|to retire)\b/gi, person: 'before', movement: 'left' },
  { re: /\b(?:promoted to|elevated to)\b/gi, person: 'before', movement: 'promoted' },
  { re: /\b(?:takes over as|will take over as|succeeds|will succeed|to become|becomes)\b/gi, person: 'before', movement: 'joined' },
];

// Cheap pre-filter, so the anchor scan only runs on plausible articles
const TRIGGER = /\b(appoint\w*|announc\w*|confirm\w*|welcom\w*|names?|named|hires?|hired|joins?|joined|joining|promot\w*|elevat\w*|steps? down|stepping down|resign\w*|departs?|departed|to leave|is leaving|retir\w*|takes over|becomes?|succeeds?|taps|tapped)\b/i;

// Where they came from, or where they are going. Optional - most moves do not
// say, and inventing a previous employer would be the worst error available here.
//
// Deliberately case-SENSITIVE. With the /i flag `[A-Z]` also matches lowercase,
// so "joins from Mizuho where he led quant research" captured the whole tail as
// the employer's name. The verbs carry their own optional capital instead.
const COUNTERPARTY = [
  /\b(?:[Ee]x|[Ff]ormer(?:ly)?(?:\s+of)?)[\s-]+([A-Z][\w&'’.-]*(?:\s+[A-Z][\w&'’.-]*){0,3})/,
  // "joins from Mizuho" and "joins HSBC from Mizuho" - the employer being left
  // sits after "from" either way, with the new one optionally in between
  /\b[Jj]oins?\s+(?:[A-Z][\w&'’.-]*(?:\s+[A-Z][\w&'’.-]*){0,3}\s+)?from\s+([A-Z][\w&'’.-]*(?:\s+[A-Z][\w&'’.-]*){0,3})/,
  /\b(?:[Aa]rrives|[Cc]omes|[Mm]oves|[Jj]oining)\s+from\s+([A-Z][\w&'’.-]*(?:\s+[A-Z][\w&'’.-]*){0,3})/,
  /\b(?:[Ll]eaves?|[Dd]eparts?|[Ee]xits?)\s+(?:for|to join)\s+([A-Z][\w&'’.-]*(?:\s+[A-Z][\w&'’.-]*){0,3})/,
];

const strip = word => word.replace(/^[^\w'’-]+|[^\w'’-]+$/g, '');

/**
 * Grow a name outward from the verb, shortest valid run winning.
 *
 * Four words back from "steps down" is "HSBC CFO Georges Elhedery"; three is
 * "CFO Georges Elhedery"; two is "Georges Elhedery", which is the answer. The
 * loop runs long-to-short and returns the first run that passes, so a genuine
 * three-word name is still preferred over its last two words.
 */
function nameBefore(text, index, tokens) {
  const words = text.slice(0, index).trim().split(/\s+/).filter(Boolean);

  for (let n = Math.min(4, words.length); n >= 2; n -= 1) {
    const candidate = words.slice(words.length - n).map(strip).join(' ').trim();
    if (looksLikePerson(candidate, tokens)) return candidate;
  }
  return '';
}

function nameAfter(text, index, tokens) {
  const words = text.slice(index).trim().split(/\s+/).filter(Boolean);

  for (let n = Math.min(4, words.length); n >= 2; n -= 1) {
    const candidate = words.slice(0, n).map(strip).join(' ').trim();
    if (looksLikePerson(candidate, tokens)) return candidate;
  }
  return '';
}

/**
 * The title attached to the move.
 *
 * Taken from the "as ..." or "to ..." clause that follows, and from the words
 * immediately before the name when the headline leads with the title -
 * "HSBC CFO Georges Elhedery steps down" states the role before the person.
 */
function roleFor(text, anchorEnd, person) {
  const after = text.slice(anchorEnd);

  const clause = /^\s*(?:as|to)\s+(?:its\s+|the\s+|their\s+|a\s+)?([^,.;]{3,80})/.exec(after)
    || /\b(?:as|to)\s+(?:its\s+|the\s+|their\s+|a\s+)?([^,.;]{3,80})/.exec(after);

  const fromClause = cleanRole(clause?.[1]);
  if (fromClause) return fromClause;

  // "Jane Okonjo to become Chief Data Officer" - after "become", "takes over
  // as" and the passive forms, the title follows the verb with nothing between
  const direct = cleanRole(after.trim().slice(0, 90));
  if (direct) return direct;

  // "HSBC CFO Georges Elhedery" - the role sits in front of the name
  const at = text.indexOf(person);
  if (at > 0) {
    const preceding = text.slice(0, at).trim().split(/\s+/).slice(-4).join(' ');
    return cleanRole(preceding);
  }

  return '';
}

function findCounterparty(text, tokens) {
  for (const pattern of COUNTERPARTY) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;

    const value = match[1].trim().replace(/[.,;]$/, '');
    // "ex-HSBC" on an HSBC story is the company itself, not a previous employer
    const words = value.toLowerCase().split(/\s+/);
    if (words.some(w => tokens.has(w))) continue;
    if (value.length < 2 || value.length > 45) continue;

    return value;
  }
  return '';
}

/**
 * @param {object[]} articles from the shared crawl
 * @param {object} company
 * @returns {object[]} executive move records, newest first
 */
function extract(articles = [], company = {}) {
  const tokens = companyTokens(company);
  const records = [];

  for (const article of articles) {
    if (!article?.title) continue;

    const text = articleText(article);
    if (!TRIGGER.test(text)) continue;
    // A move at another company, returned by a feed we searched for this one
    if (!mentionsCompany(article, company)) continue;

    // No date, no record - the section is dated and cannot carry an undated row
    const date = announcedAt(article);
    if (!date) continue;

    let found = null;

    for (const anchor of ANCHORS) {
      // Fresh lastIndex per article: these are module-level /g regexes
      anchor.re.lastIndex = 0;

      let match;
      while ((match = anchor.re.exec(text)) !== null) {
        const end = match.index + match[0].length;

        const person = anchor.person === 'after'
          ? nameAfter(text, end, tokens)
          : anchor.person === 'before'
            ? nameBefore(text, match.index, tokens)
            : nameAfter(text, end, tokens) || nameBefore(text, match.index, tokens);

        if (!person) continue;

        const role = roleFor(text, match.index + match[0].length, person);
        // The role is optional on an exit - "Jane Doe steps down" is still a
        // complete, checkable fact - but must be a real title when present
        if (anchor.movement !== 'left' && !role) continue;

        found = { person, role, movement: anchor.movement };
        break;
      }

      if (found) break;
    }

    if (!found) continue;

    records.push({
      ...found,
      counterparty: findCounterparty(text, tokens),
      announcedAt: date,
      url: article.url,
      source: article.publisher || 'News',
      // Set by intelligenceService once the article has a source number
      citations: [],
      _article: article,
    });
  }

  // The same appointment is reported by a dozen outlets. Keep the copy with the
  // most complete record, preferring one that also names where they came from.
  const unique = dedupeBy(
    records,
    record => `${record.person.toLowerCase()}|${record.movement}`,
    (candidate, existing) => {
      const weight = r => (r.role ? 2 : 0) + (r.counterparty ? 1 : 0);
      return weight(candidate) > weight(existing);
    }
  );

  return unique.sort(byDateDesc);
}

/**
 * "Christian Schwarz — Head of Markets Analytics & AI (May 2026, ex-Mizuho)"
 *
 * The exact shape the report renders, built here so the PDF and the web view
 * cannot drift apart.
 */
function format(record) {
  if (!record?.person) return '';

  const date = record.announcedAt
    ? new Date(record.announcedAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '';

  const head = record.movement === 'left'
    ? `${record.person} — stepped down${record.role ? ` as ${record.role}` : ''}`
    : `${record.person} — ${record.movement === 'promoted' ? 'promoted to ' : ''}${record.role}`;

  const context = [
    date,
    record.counterparty
      ? (record.movement === 'left' ? `now at ${record.counterparty}` : `ex-${record.counterparty}`)
      : null,
  ].filter(Boolean).join(', ');

  return context ? `${head} (${context})` : head;
}

module.exports = { extract, format };
