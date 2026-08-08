const axios = require('axios');
const cheerio = require('cheerio');
const Parser = require('rss-parser');

const accountTagging = require('../accountTagging');

/**
 * One crawl, read by everything.
 *
 * Before this, each feature that needed news ran its own search: the report ran
 * one Google News query, the signals refresh ran another, and nothing else had
 * a source at all. That capped a report at about nine sources while a
 * competitor's ran on eighty, and it meant executive moves, named programmes,
 * regulatory actions and quotes were all being looked for in a pool too small
 * to contain them.
 *
 * So the crawl happens once, wide, and every extractor reads the same articles.
 * Fixes 1, 4, 6 and 7 add no requests of their own - they are passes over this
 * result. Adding a new extractor costs nothing; adding a new query costs one
 * request on every report, which is why the query plan below is explicit rather
 * than generated.
 *
 * Everything here is keyless. Nothing is scraped from a site that forbids it:
 * paywalled and ToS-sensitive publishers are reached through Google News, which
 * yields the headline, date and link without touching the publisher.
 */

// Total articles kept from one crawl. The binding constraint is not the feeds -
// it is that every source reaching the prompt is re-sent on each of the five AI
// passes, so this is the number that decides report cost.
const MAX_ARTICLES = Number(process.env.MAX_CRAWL_ARTICLES) || 100;

// Per-feed ceiling, so one prolific query cannot crowd out the other thirty
const PER_FEED = Number(process.env.MAX_ARTICLES_PER_FEED) || 8;

// How many trade-press and regulator hosts to query per report. Each is one
// request; the lists in accountTagging run to twelve for some verticals.
const MAX_PRESS_HOSTS = Number(process.env.MAX_PRESS_HOSTS) || 6;
const MAX_REGULATOR_HOSTS = Number(process.env.MAX_REGULATOR_HOSTS) || 4;

// The window every crawl works in. Older coverage describes a company that no
// longer exists in the way the report is about to claim it does.
const WINDOW_DAYS = Number(process.env.CRAWL_WINDOW_DAYS) || 90;

// GDELT answers 429 with "limit requests to one every 5 seconds". It is the one
// feed here with a published rate limit, so calls are serialised through a
// promise chain rather than fired alongside the rest.
const GDELT_MIN_GAP_MS = 5200;

const USER_AGENT =
  process.env.CRAWL_USER_AGENT ||
  'SalesMotion/1.0 (+https://salesmotion.local; account intelligence)';

const parser = new Parser({
  timeout: 12000,
  headers: { 'User-Agent': USER_AGENT },
});

// Publishers that republish other outlets verbatim. When a story appears twice
// the copy from one of these loses to the copy that is not, so the reference
// list names whoever actually broke it.
const SYNDICATORS = [
  'msn.com', 'news.yahoo.com', 'finance.yahoo.com', 'yahoo.com',
  'benzinga.com', 'simplywall.st', 'investing.com', 'marketscreener.com',
  'stocktitan.net', 'nasdaq.com', 'tipranks.com', 'insidermonkey.com',
  'zacks.com', 'gurufocus.com', 'aol.com', 'newsbreak.com',
];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function hostname(url) {
  if (!url) return '';
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '').toLowerCase();
  } catch (_) {
    return String(url).replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
  }
}

/**
 * Which outlet an article is actually from.
 *
 * Google News hands back a `news.google.com` redirect for every item, so the
 * URL host identifies the aggregator rather than the publisher. Counting those
 * would report every report as having one source domain, and the syndication
 * check would never fire. The publisher named in the headline is the real
 * answer; the URL is only the fallback for feeds that give a direct link.
 */
function publisherKey(article = {}) {
  const named = String(article.publisher || '')
    .toLowerCase()
    .replace(/\s*[-–|].*$/, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();

  if (named) return named;

  const host = hostname(article.url);
  return host && host !== 'news.google.com' ? host : '';
}

function isSyndicator(article = {}) {
  const host = hostname(article.url);
  if (host && host !== 'news.google.com'
      && SYNDICATORS.some(s => host === s || host.endsWith(`.${s}`))) {
    return true;
  }

  // Matched on the name too, because the host is usually the aggregator's
  const key = publisherKey(article);
  return Boolean(key) && SYNDICATORS.some(s => key === s.replace(/[^a-z0-9]/g, ''));
}

function windowStart() {
  return new Date(Date.now() - WINDOW_DAYS * 86400000);
}

/**
 * Google News sets the title to "Headline - Publisher". The publisher is the
 * only place the originating outlet appears - `item.link` is a Google redirect
 * and `item.source` is often absent - so it is split off here and the headline
 * kept clean.
 */
function splitGoogleTitle(title) {
  const value = String(title || '').trim();
  const cut = value.lastIndexOf(' - ');

  // A hyphen inside the headline itself is common; a publisher name is short
  // and sits at the very end, so only a short trailing segment is treated as one
  if (cut > 20 && value.length - cut < 45) {
    return { title: value.slice(0, cut).trim(), publisher: value.slice(cut + 3).trim() };
  }
  return { title: value, publisher: '' };
}

function stripHtml(value) {
  if (!value) return '';
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The key two articles are considered the same story by.
 *
 * Wire copy is reworded at the edges - a publisher's own prefix, a trailing
 * "- Reuters", different punctuation - so comparing raw titles finds almost no
 * duplicates. Reducing to a sorted set of significant words catches the copies
 * that matter without merging two genuinely different stories about one event.
 */
function dedupeKey(title) {
  const words = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3);

  // Long headlines are distinctive enough on their first significant words;
  // short ones need all of them
  return [...new Set(words)].sort().slice(0, 9).join(' ');
}

// ---------------------------------------------------------------------------
// Feeds
// ---------------------------------------------------------------------------

async function readFeed(url, { origin, matchedKeyword } = {}) {
  try {
    const feed = await parser.parseURL(url);

    return (feed.items || []).slice(0, PER_FEED).map(item => {
      const { title, publisher } = splitGoogleTitle(item.title);

      return {
        title,
        description: stripHtml(item.contentSnippet || item.content || item.summary || ''),
        url: item.link,
        publishedAt: item.isoDate || item.pubDate || null,
        // The outlet named in the headline is the real one; the feed itself is
        // only how we found it
        publisher: publisher || feed.title || '',
        origin,
        matchedKeyword,
      };
    });
  } catch (error) {
    // A dead feed is the normal answer for a `site:` query that matched nothing
    return [];
  }
}

function googleNewsUrl(query) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
}

function bingNewsUrl(query) {
  return `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=RSS`;
}

/**
 * GDELT, serialised.
 *
 * Its rate limit is per-caller and strict, so every call in the process queues
 * behind the last one. That makes it the slowest feed in the crawl, which is
 * why exactly one query is issued per report rather than one per theme.
 */
let gdeltChain = Promise.resolve();
let gdeltLastCall = 0;

function fetchGdelt(companyName) {
  const run = async () => {
    const wait = GDELT_MIN_GAP_MS - (Date.now() - gdeltLastCall);
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    gdeltLastCall = Date.now();

    try {
      const { data } = await axios.get('https://api.gdeltproject.org/api/v2/doc/doc', {
        params: {
          query: `"${companyName}"`,
          mode: 'artlist',
          format: 'json',
          maxrecords: 40,
          timespan: `${WINDOW_DAYS}d`,
          sort: 'datedesc',
        },
        headers: { 'User-Agent': USER_AGENT },
        timeout: 15000,
      });

      // Over the limit GDELT answers 200 with a plain-text scolding, not JSON
      if (typeof data === 'string' || !Array.isArray(data?.articles)) return [];

      return data.articles.slice(0, 25).map(a => ({
        title: a.title,
        description: '',
        url: a.url,
        // "20260514T120000Z" - not a format Date parses on its own
        publishedAt: a.seendate
          ? a.seendate.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/, '$1-$2-$3T$4:$5:$6Z')
          : null,
        publisher: a.domain || '',
        origin: 'gdelt',
      }));
    } catch (error) {
      console.warn(`⚠️ GDELT unavailable: ${error.message}`);
      return [];
    }
  };

  const queued = gdeltChain.then(run, run);
  // Keep the chain alive whatever one call did, or every later call inherits
  // the rejection and GDELT is off for the lifetime of the process
  gdeltChain = queued.then(() => {}, () => {});
  return queued;
}

/** NewsAPI, when a key is set. Free keys are localhost-only and 426 in production. */
async function fetchNewsApi(companyName) {
  if (!process.env.NEWS_API_KEY) return [];

  try {
    const { data } = await axios.get('https://newsapi.org/v2/everything', {
      params: {
        q: `"${companyName}"`,
        sortBy: 'publishedAt',
        language: 'en',
        pageSize: 20,
        from: windowStart().toISOString().slice(0, 10),
        apiKey: process.env.NEWS_API_KEY,
      },
      timeout: 8000,
    });

    return (data.articles || []).map(a => ({
      title: a.title,
      description: stripHtml(a.description || ''),
      url: a.url,
      publishedAt: a.publishedAt,
      publisher: a.source?.name || '',
      origin: 'newsapi',
    }));
  } catch (error) {
    // 426 is the expected answer from a deployed server on a free key
    const status = error?.response?.status;
    if (status === 426) {
      console.log('📰 NewsAPI free-tier key is localhost-only — skipped in this environment');
    }
    return [];
  }
}

/**
 * The company's own feed - press releases, the newsroom, the blog.
 *
 * First-party and therefore the highest-trust source in the crawl: a senior
 * hire or a named programme usually appears here before anyone reports it.
 */
async function fetchFirstParty(company) {
  const pages = company.pages || {};

  const feeds = [
    [pages.blogRssUrl, 'blog'],
    [pages.pressUrl, 'press'],
    [pages.investorRelationsUrl, 'ir'],
  ].filter(([url]) => url);

  if (!feeds.length) return [];

  const results = await Promise.all(
    feeds.map(async ([url, origin]) => {
      // A newsroom URL is usually a web page rather than a feed, so the page is
      // read for the feed it advertises before giving up on it
      const direct = await readFeed(url, { origin });
      if (direct.length) return direct;

      const discovered = await discoverFeed(url);
      return discovered ? readFeed(discovered, { origin }) : [];
    })
  );

  return results.flat();
}

/**
 * Find the RSS feed a page advertises in its <head>.
 *
 * Used both to turn a newsroom URL into something readable and to fill in a
 * blog feed nobody has set by hand. Best-effort by nature: a site that does not
 * advertise a feed simply contributes nothing.
 */
async function discoverFeed(pageUrl) {
  if (!pageUrl) return null;

  try {
    const { data } = await axios.get(pageUrl, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 10000,
      maxContentLength: 5 * 1024 * 1024,
      responseType: 'text',
      transformResponse: [d => d],
    });

    const $ = cheerio.load(String(data || ''));
    const href = $('link[rel="alternate"]')
      .filter((_, el) => /rss|atom|xml/i.test($(el).attr('type') || ''))
      .first()
      .attr('href');

    if (!href) return null;
    return new URL(href, pageUrl).href;
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Query plan
// ---------------------------------------------------------------------------

/**
 * The themes worth asking for by name.
 *
 * A bare company-name search returns whatever is loudest that week, which for a
 * large account is share-price commentary. These ask directly for the five
 * things a rep actually needs, and are what lifts a crawl from nine usable
 * sources to thirty.
 */
const THEMES = [
  { suffix: 'hiring OR "open roles" OR recruitment', reason: 'hiring' },
  { suffix: 'earnings OR results OR profit OR revenue', reason: 'earnings' },
  { suffix: 'partnership OR contract OR deal OR acquisition', reason: 'partnership' },
  { suffix: 'restructuring OR "cost savings" OR layoffs OR "job cuts"', reason: 'restructuring' },
  { suffix: '"strategic plan" OR transformation OR "growth plan" OR "investor day"', reason: 'program' },
  { suffix: 'appointed OR "joins as" OR "steps down" OR "new chief"', reason: 'people' },
];

function buildPlan(company, keywords = []) {
  const name = company.name;
  const quoted = `"${name}"`;
  const plan = [];

  plan.push({ url: googleNewsUrl(quoted), origin: 'google-news', reason: 'news' });

  THEMES.forEach(theme => {
    plan.push({
      url: googleNewsUrl(`${quoted} ${theme.suffix}`),
      origin: 'google-news',
      reason: theme.reason,
    });
  });

  // What the seller is actually pitching. Tagged so the ranking in
  // intelligenceService can float these above general coverage.
  keywords.filter(Boolean).slice(0, 5).forEach(term => {
    plan.push({
      url: googleNewsUrl(`${quoted} ${term}`),
      origin: 'google-news',
      reason: 'news',
      matchedKeyword: String(term).trim(),
    });
  });

  // Trade press. Reached through Google News rather than fetched directly, so a
  // paywall costs us the body but never the headline, date or link.
  accountTagging.pressHosts(company).slice(0, MAX_PRESS_HOSTS).forEach(host => {
    plan.push({
      url: googleNewsUrl(`site:${host} ${quoted}`),
      origin: `trade:${host}`,
      reason: 'program',
    });
  });

  // Regulators, for regulated accounts only. Everywhere else these return
  // nothing and cost a request each.
  accountTagging.regulatorFeeds(company).slice(0, MAX_REGULATOR_HOSTS).forEach(feed => {
    plan.push({
      url: googleNewsUrl(`site:${feed.host} ${quoted}`),
      origin: `regulator:${feed.host}`,
      reason: 'regulatory',
      regulator: feed.name,
    });
  });

  // A second search engine, so one index's blind spot is not the report's
  plan.push({ url: bingNewsUrl(quoted), origin: 'bing-news', reason: 'news' });
  plan.push({
    url: bingNewsUrl(`${quoted} earnings OR restructuring OR appointed`),
    origin: 'bing-news',
    reason: 'news',
  });

  return plan;
}

// ---------------------------------------------------------------------------
// Dedupe
// ---------------------------------------------------------------------------

/**
 * Collapse the syndicated copies of one story into the best single record.
 *
 * "Best" means the original publisher wherever it can be told apart: a story
 * carried by MSN, Yahoo and Benzinga should appear once, under whoever wrote
 * it. Between two equally original copies the one with a real date and a
 * description wins, since that is the copy the model can actually use.
 */
function dedupe(articles) {
  const byKey = new Map();
  let dropped = 0;

  const score = article => {
    let value = 0;
    if (!isSyndicator(article)) value += 100;
    if (article.origin === 'press' || article.origin === 'ir' || article.origin === 'blog') value += 200;
    if (String(article.origin || '').startsWith('trade:')) value += 40;
    if (String(article.origin || '').startsWith('regulator:')) value += 60;
    if (article.description) value += 10;
    if (article.publishedAt) value += 5;
    if (article.matchedKeyword) value += 20;
    return value;
  };

  for (const article of articles) {
    if (!article?.title) continue;

    const key = dedupeKey(article.title);
    if (!key) continue;

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, article);
      continue;
    }

    dropped += 1;

    if (score(article) > score(existing)) {
      // The better copy takes over, but keeps what the loser knew - a keyword
      // tag or a description earned by the copy being replaced
      byKey.set(key, {
        ...article,
        description: article.description || existing.description,
        matchedKeyword: article.matchedKeyword || existing.matchedKeyword,
        alsoCarriedBy: [...(existing.alsoCarriedBy || []), existing.publisher].filter(Boolean),
      });
    } else if (article.matchedKeyword && !existing.matchedKeyword) {
      existing.matchedKeyword = article.matchedKeyword;
    }
  }

  return { articles: [...byKey.values()], dropped };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * @param {object} company   the Company document (tags and pages steer the plan)
 * @param {string[]} keywords the seller's pitch terms, used to add targeted queries
 * @returns {Promise<{articles: object[], stats: object}>}
 */
async function crawl(company, keywords = []) {
  const plan = buildPlan(company, keywords);

  console.log(`🌐 Crawling ${plan.length} feeds for ${company.name}` +
    `${company.tags?.vertical ? ` (${company.tags.vertical})` : ''}`);

  const [planned, gdelt, newsApi, firstParty] = await Promise.all([
    Promise.all(plan.map(entry =>
      readFeed(entry.url, { origin: entry.origin, matchedKeyword: entry.matchedKeyword })
        .then(items => items.map(item => ({
          ...item,
          reason: entry.reason,
          regulator: entry.regulator,
        })))
    )).then(results => results.flat()),
    fetchGdelt(company.name),
    fetchNewsApi(company.name),
    fetchFirstParty(company),
  ]);

  const cutoff = windowStart();

  const all = [...firstParty, ...planned, ...gdelt, ...newsApi]
    .filter(a => a?.title && a.url)
    // Undated articles are kept: Google News omits the date on some items, and
    // dropping them would throw away real coverage to enforce a window
    .filter(a => !a.publishedAt || new Date(a.publishedAt) >= cutoff);

  const { articles, dropped } = dedupe(all);

  const byRecency = (a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0);
  // First-party and keyword-matched coverage survives the cap ahead of general
  // news, because it is the coverage the report is actually written from
  const priority = a =>
    (a.origin === 'press' || a.origin === 'ir' || a.origin === 'blog' ? 0 : 1);

  const kept = articles
    .sort((a, b) => priority(a) - priority(b) || byRecency(a, b))
    .slice(0, MAX_ARTICLES);

  // Counted by publisher, not by URL host: every Google News link points at
  // news.google.com, so hosts would report one domain for the whole report
  const domains = new Set(kept.map(publisherKey).filter(Boolean));

  const stats = {
    feedsQueried: plan.length + 3,
    articlesFetched: all.length,
    duplicatesDropped: dropped,
    kept: kept.length,
    uniqueDomains: domains.size,
  };

  console.log(
    `✅ ${stats.kept} articles kept from ${stats.articlesFetched} fetched ` +
    `(${stats.duplicatesDropped} duplicates, ${stats.uniqueDomains} domains)`
  );

  return { articles: kept, stats };
}

module.exports = {
  crawl,
  discoverFeed,
  hostname,
  publisherKey,
  dedupeKey,
  stripHtml,
  MAX_ARTICLES,
  WINDOW_DAYS,
};
