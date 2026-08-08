const Company = require('../models/Company');
const Signal = require('../models/Signal');
const aiEngine = require('./aiEngine');
const accountTagging = require('./accountTagging');
const crawlService = require('./dataFetchers/crawlService');
const financialDataFetcher = require('./dataFetchers/financialDataFetcher');
const jobDataFetcher = require('./dataFetchers/jobDataFetcher');
const patentFetcher = require('./dataFetchers/patentFetcher');
const contractFetcher = require('./dataFetchers/contractFetcher');
const companyDataFetcher = require('./dataFetchers/companyDataFetcher');
const executiveMoves = require('./extractors/executiveMoves');
const strategicPrograms = require('./extractors/strategicPrograms');
const regulatoryActions = require('./extractors/regulatoryActions');

/**
 * Turning a crawl into signals.
 *
 * Owns the work behind both the Refresh button and the daily sweep, so the two
 * cannot drift: whatever a user sees after pressing Refresh is exactly what
 * would have appeared overnight without them.
 *
 * Reports are deliberately NOT generated here. A report is written when a rep
 * asks for one, against the profile as it stands at that moment; regenerating
 * it nightly would silently rewrite a document somebody may already have sent.
 * Signals are the opposite - they are a feed, and a feed that only updates when
 * clicked is not a feed.
 */

// Each new signal costs one AI call for its summary. Uncapped, an account with
// a busy news week could run up dozens across a nightly sweep of every account.
const MAX_AI_ANALYSES = Number(process.env.SIGNAL_MAX_AI_PER_COMPANY) || 10;

// How many news items become signals per run, before the extracted records
const MAX_NEWS_SIGNALS = Number(process.env.SIGNAL_MAX_NEWS) || 8;

// Classify a news item so signals are not all filed as generic 'news'
const RULES = [
  { type: 'earnings', priority: 'high', words: ['earnings', 'quarterly results', 'revenue beat', 'q1 ', 'q2 ', 'q3 ', 'q4 ', 'fiscal year'] },
  { type: 'ma', priority: 'high', words: ['acquire', 'acquisition', 'merger', 'buyout', 'takeover'] },
  { type: 'funding', priority: 'high', words: ['funding', 'raises', 'series a', 'series b', 'series c', 'investment round', 'valuation'] },
  { type: 'executive', priority: 'high', words: ['ceo', 'cfo', 'cto', 'appointed', 'steps down', 'resigns', 'named president'] },
  { type: 'hiring', priority: 'medium', words: ['hiring', 'layoff', 'job cuts', 'headcount', 'expands team', 'recruit'] },
  { type: 'partnership', priority: 'medium', words: ['partnership', 'partners with', 'collaboration', 'teams up', 'alliance'] },
  { type: 'regulation', priority: 'high', words: ['lawsuit', 'regulator', 'antitrust', 'investigation', 'fine', 'compliance'] },
  { type: 'product', priority: 'medium', words: ['launch', 'unveils', 'releases', 'introduces', 'new product'] },
];

function classifySignal(article) {
  const text = `${article.title || ''} ${article.description || ''}`.toLowerCase();

  for (const rule of RULES) {
    if (rule.words.some(word => text.includes(word))) {
      return { type: rule.type, priority: rule.priority };
    }
  }

  return { type: 'news', priority: 'medium' };
}

/**
 * Store a signal unless the same story is already on file.
 *
 * Deduped on the source URL where there is one and on the title otherwise: the
 * same appointment reported twice under slightly different headlines would
 * otherwise appear twice in the feed.
 */
async function saveSignal(company, payload) {
  const filter = payload.sourceUrl
    ? { companyId: company._id, sourceUrl: payload.sourceUrl }
    : { companyId: company._id, title: payload.title };

  if (await Signal.findOne(filter)) return false;

  await new Signal({
    companyId: company._id,
    companyName: company.name,
    ticker: company.ticker,
    ...payload,
  }).save();

  return true;
}

/**
 * One account's refresh: crawl, extract, file the signals.
 *
 * @param {object} company  Company document
 * @param {string[]} keywords the tenant's monitored topics, to bias the crawl
 * @param {object} [options]
 * @param {boolean} [options.analyse] run the AI summary on new signals
 */
async function refreshCompany(company, keywords = [], { analyse = true } = {}) {
  console.log(`🔄 Refreshing signals for ${company.name}`);

  // Accounts added before tagging existed have none, so the crawl would skip
  // their trade press and regulator feeds entirely
  if (accountTagging.backfill(company)) {
    await company.save().catch(() => {});
  }

  const [crawl, financial, jobs, patents, awards] = await Promise.all([
    crawlService.crawl(company, keywords).catch(() => ({ articles: [], stats: {} })),
    company.ticker
      ? financialDataFetcher.fetchFinancialData(company.ticker, company).catch(() => ({}))
      : Promise.resolve({}),
    jobDataFetcher.fetchJobData(company, keywords).catch(() => ({ openPositions: [], hiring: null })),
    patentFetcher.fetchPatents(company).catch(() => []),
    contractFetcher.fetchAwards(company).catch(() => []),
  ]);

  const news = crawl.articles;
  let created = 0;
  let analysed = 0;

  // --- General coverage ---------------------------------------------------
  for (const item of news.slice(0, MAX_NEWS_SIGNALS)) {
    if (!item.title) continue;

    const { type, priority } = classifySignal(item);

    const payload = {
      type,
      priority,
      title: item.title,
      description: item.description,
      source: item.publisher || 'News',
      sourceUrl: item.url,
      publishedAt: item.publishedAt,
    };

    // The summary is worth an AI call on the signals that carry a decision,
    // not on every headline that mentioned the company
    if (analyse && analysed < MAX_AI_ANALYSES && priority === 'high') {
      const summary = await aiEngine.analyzeSignal(item, { company: company.name, keywords })
        .catch(() => '');
      if (summary) {
        payload.aiAnalysis = { summary, generatedAt: new Date() };
        analysed += 1;
      }
    }

    if (await saveSignal(company, payload)) created += 1;
  }

  // --- Extracted records --------------------------------------------------
  //
  // These carry a name, a figure and a date, which is what makes them worth a
  // higher priority than the headline they were read out of.

  for (const program of strategicPrograms.extract(news, company).slice(0, 3)) {
    const saved = await saveSignal(company, {
      type: 'program',
      priority: 'critical',
      title: strategicPrograms.format(program),
      description: program.summary,
      source: program.source,
      sourceUrl: program.url,
      publishedAt: program.announcedAt,
    });
    if (saved) created += 1;
  }

  for (const action of regulatoryActions.extract(news, company).slice(0, 3)) {
    const saved = await saveSignal(company, {
      type: 'regulation',
      priority: 'critical',
      title: regulatoryActions.format(action),
      description: action.detail,
      source: action.source,
      sourceUrl: action.url,
      publishedAt: action.announcedAt,
    });
    if (saved) created += 1;
  }

  for (const move of executiveMoves.extract(news, company).slice(0, 4)) {
    const saved = await saveSignal(company, {
      type: 'executive',
      priority: 'high',
      title: executiveMoves.format(move),
      description: move.role || '',
      source: move.source,
      sourceUrl: move.url,
      publishedAt: move.announcedAt,
    });
    if (saved) created += 1;
  }

  for (const patent of patents.slice(0, 3)) {
    const saved = await saveSignal(company, {
      type: 'patent',
      priority: 'medium',
      title: `Patent: ${patent.title}`,
      description: `${patentFetcher.format(patent)} — ${patent.applicant}`,
      source: 'USPTO',
      sourceUrl: patent.url,
      publishedAt: patent.grantedAt || patent.filedAt,
    });
    if (saved) created += 1;
  }

  for (const award of awards.slice(0, 3)) {
    const saved = await saveSignal(company, {
      type: 'contract',
      priority: 'high',
      title: `Federal award: ${contractFetcher.format(award)}`,
      description: award.description,
      source: 'USAspending.gov',
      sourceUrl: award.url,
      publishedAt: award.startedAt,
    });
    if (saved) created += 1;
  }

  console.log(`✅ ${company.name}: ${created} new signal(s) from ${news.length} articles`);

  return {
    created,
    newsFound: news.length,
    jobsFound: jobs.openPositions?.length || 0,
    patentsFound: patents.length,
    awardsFound: awards.length,
    financial,
    jobs,
    crawlStats: crawl.stats,
  };
}

/**
 * The nightly sweep over every account.
 *
 * Runs against all Company documents, not just watched ones: an account is only
 * in the collection because somebody added it, and a signal that is missing
 * because nobody had the account open yesterday is a signal the product failed
 * to deliver.
 *
 * Accounts are refreshed one at a time rather than in parallel. GDELT rate
 * limits to one request every five seconds and the ATS boards are somebody
 * else's infrastructure; a nightly job has all the time it needs.
 */
async function sweep({ limit = 0 } = {}) {
  const companies = await Company.find({}).sort({ updatedAt: 1 });
  const batch = limit > 0 ? companies.slice(0, limit) : companies;

  if (!batch.length) {
    console.log('📡 Signal sweep: no accounts on file.');
    return { companies: 0, created: 0 };
  }

  console.log(`📡 Signal sweep starting over ${batch.length} account(s)`);

  let created = 0;
  let failed = 0;

  for (const company of batch) {
    try {
      // No tenant here: the sweep is shared across every organisation watching
      // the account, so it runs on the company's own terms rather than one
      // tenant's topic list.
      const result = await refreshCompany(company, [], { analyse: true });
      created += result.created;

      if (!company.dataSources) company.dataSources = {};
      company.dataSources.news = { lastFetched: new Date(), status: 'success' };
      company.updatedAt = new Date();
      await company.save().catch(() => {});
    } catch (error) {
      failed += 1;
      console.error(`❌ Signal sweep failed for ${company.name}: ${error.message}`);
    }
  }

  console.log(`📡 Signal sweep done: ${created} new signal(s), ${failed} account(s) failed`);
  return { companies: batch.length, created, failed };
}

module.exports = {
  refreshCompany,
  sweep,
  classifySignal,
  companyDataFetcher,
};
