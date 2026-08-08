const aiEngine = require('./aiEngine');
const { scoreAccount } = require('./scoring');
const crawlService = require('./dataFetchers/crawlService');
const financialDataFetcher = require('./dataFetchers/financialDataFetcher');
const jobDataFetcher = require('./dataFetchers/jobDataFetcher');
const patentFetcher = require('./dataFetchers/patentFetcher');
const contractFetcher = require('./dataFetchers/contractFetcher');
const executiveMoves = require('./extractors/executiveMoves');
const strategicPrograms = require('./extractors/strategicPrograms');
const regulatoryActions = require('./extractors/regulatoryActions');

// The source block is repeated verbatim in every AI pass, so its length is the
// single biggest driver of prompt size. On Groq's free tier (12k tokens/min) a
// full-length list made one request larger than the whole per-minute budget.
//
// These are sized for Azure's 272k input window, which serves the primary
// traffic. Groq stays configured as insurance and will refuse the largest
// reports; that is the intended trade, not a regression.
const MAX_NEWS_SOURCES = Number(process.env.MAX_NEWS_SOURCES) || 30;
const MAX_JOB_SOURCES = Number(process.env.MAX_JOB_SOURCES) || 8;
const MAX_FILING_SOURCES = Number(process.env.MAX_FILING_SOURCES) || 5;
const MAX_PATENT_SOURCES = Number(process.env.MAX_PATENT_SOURCES) || 6;
const MAX_CONTRACT_SOURCES = Number(process.env.MAX_CONTRACT_SOURCES) || 6;
const MAX_TRANSCRIPT_SOURCES = Number(process.env.MAX_TRANSCRIPT_SOURCES) || 2;

// Below this the report is still written, but it says on its face that it was
// written thin rather than reading as though the evidence were there.
const THIN_COVERAGE_FLOOR = Number(process.env.THIN_COVERAGE_FLOOR) || 15;

// More sources must not become more citations per claim. Three is enough to
// show a claim is corroborated; beyond that the chips are noise.
const MAX_CITATIONS_PER_CLAIM = 3;

/**
 * Why a source is in the report.
 *
 * Shown against the entry in the reference list and on hovering a citation
 * chip, so a reader can tell whether a claim rests on a filed number or on a
 * press mention without opening anything.
 */
const CITATION_REASONS = {
  financial: 'Financial snapshot',
  earnings: 'Reported results',
  filing: 'Regulatory filing',
  transcript: 'Earnings call',
  program: 'Strategic programme',
  regulatory: 'Regulatory action',
  people: 'Leadership change',
  hiring: 'Hiring activity',
  job: 'Open role',
  patent: 'Patent record',
  contract: 'Federal contract',
  partnership: 'Partnership / deal',
  restructuring: 'Restructuring',
  news: 'News coverage',
};

// Orchestrates one report: gather evidence -> extract the verifiable records ->
// number the sources -> score the account -> run the AI passes -> normalise
// everything into the Report shape.
class IntelligenceService {
  // ---- normalisation -----------------------------------------------------

  // The model is told to return {text, citations} but sometimes returns a bare
  // string, or an object with a different key. Accept all of it.
  toInsights(value, limit = 12) {
    if (!value) return [];

    const list = Array.isArray(value) ? value : [value];

    return list
      .map(item => {
        if (typeof item === 'string') return { text: item.trim(), citations: [] };
        if (!item || typeof item !== 'object') return null;

        const text = item.text || item.insight || item.point || item.description || item.title;
        if (!text) return null;

        return {
          text: String(text).trim(),
          citations: this.toCitations(item.citations),
        };
      })
      .filter(item => item && item.text.length > 2)
      .slice(0, limit);
  }

  /**
   * Talking points carry more than a claim: the spoken body, the question to
   * ask, the proof to drop and the objection to expect. Older reports - and a
   * model that ignores the contract - hold a plain {text} insight instead, so
   * everything but the body is optional and both shapes render.
   */
  toTalkingPoints(value, limit = 5) {
    if (!value) return [];

    const clean = v => (v === undefined || v === null ? '' : String(v).replace(/\s+/g, ' ').trim());
    const list = Array.isArray(value) ? value : [value];

    return list
      .map(item => {
        if (typeof item === 'string') return { text: item.trim(), citations: [] };
        if (!item || typeof item !== 'object') return null;

        const text = clean(item.text || item.point || item.talkingPoint || item.body || item.insight);
        const headline = clean(item.headline || item.title || item.label);
        if (!text && !headline) return null;

        return {
          // A headline that is just the body repeated adds nothing above it
          headline: headline && headline !== text ? headline : '',
          text: text || headline,
          question: clean(item.question || item.ask || item.discoveryQuestion),
          proof: clean(item.proof || item.proofPoint || item.evidence),
          objection: clean(item.objection || item.pushback || item.objectionHandling),
          citations: this.toCitations(item.citations),
        };
      })
      .filter(item => item && item.text.length > 2)
      .slice(0, limit);
  }

  /**
   * Executive quotes, held to the standard a client-facing brief needs.
   *
   * A quote must name who said it, what their job is, when they said it and
   * where it was published. "A spokesperson said" is not attribution, and a
   * competitor's brief printing exactly that is what this bar exists to avoid.
   *
   * The model is told to return nothing when it finds nothing, and this is the
   * one place it reliably ignores that - emitting "No verbatim quotes are
   * available" as if it were a quote. Those go too.
   */
  cleanQuotes(value, sources = []) {
    const REFUSALS = [
      'no verbatim', 'no quote', 'no direct quote', 'not available', 'none available',
      'no executive', 'could not find', 'unavailable', 'no statements', 'n/a',
    ];

    const byIndex = new Map(sources.map(s => [s.index, s]));
    const seen = new Set();

    return (Array.isArray(value) ? value : [])
      .map(q => {
        const raw = typeof q === 'string' ? q : q?.quote;
        if (!raw) return null;

        const quote = String(raw).replace(/^["“'']|["”'']$/g, '').trim();
        const lower = quote.toLowerCase();

        if (quote.length < 25) return null;
        if (REFUSALS.some(phrase => lower.includes(phrase))) return null;
        if (seen.has(lower)) return null;
        seen.add(lower);

        const person = typeof q === 'object' ? String(q.person || '').trim() : '';
        // A quote nobody said is not evidence
        if (!person || /^(company )?(spokesperson|executive|unknown|n\/a|ceo|cfo|cto|management)$/i.test(person)) {
          return null;
        }

        const title = (typeof q === 'object' && String(q.title || '').trim()) || '';
        // Without a title the reader cannot tell whether this is the person who
        // owns the budget or someone three levels away from it
        if (!title) return null;

        const citations = this.toCitations(typeof q === 'object' ? q.citations : []);
        const cited = citations.map(i => byIndex.get(i)).find(Boolean);

        // The date and the link both come off the cited source rather than the
        // model, so neither can be invented. No citation, no quote.
        if (!cited?.url) return null;

        return {
          quote,
          person,
          title,
          source: (typeof q === 'object' && q.source) || cited.source || '',
          url: cited.url,
          publishedAt: cited.publishedAt,
          citations,
        };
      })
      .filter(Boolean)
      // Three is the cap. A fourth quote is never the reason a deal moves.
      .slice(0, 3);
  }

  toCitations(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map(n => Number(n))
      .filter(n => Number.isInteger(n) && n > 0)
      .slice(0, MAX_CITATIONS_PER_CLAIM);
  }

  // ---- evidence gathering ------------------------------------------------

  /**
   * One crawl, then everything else in parallel against it.
   *
   * The extractors are passes over articles already in memory, so adding
   * executive moves, programmes and regulatory actions to the report costs no
   * additional requests - only the patent and contract lookups reach out, and
   * both are gated on the account's tags.
   */
  async gather(company, keywords) {
    const [crawl, financial, jobsData, patents, contractAwards] = await Promise.all([
      crawlService.crawl(company, keywords).catch(error => {
        console.error('❌ Crawl failed:', error.message);
        return { articles: [], stats: {} };
      }),
      company.ticker || company.pages?.investorRelationsUrl
        ? financialDataFetcher.fetchFinancialData(company.ticker, company).catch(() => ({}))
        : Promise.resolve({}),
      // Keywords rank the roles, not filter them: a board can return 800
      // postings and only a handful reach the prompt, so the ones that argue
      // the seller's case have to sort to the top.
      jobDataFetcher.fetchJobData(company, keywords).catch(() => ({ openPositions: [], hiring: null })),
      patentFetcher.fetchPatents(company).catch(() => []),
      contractFetcher.fetchAwards(company).catch(() => []),
    ]);

    const news = crawl.articles;

    return {
      news,
      crawlStats: crawl.stats,
      financial: financial || {},
      jobs: jobsData?.openPositions || [],
      hiring: jobsData?.hiring || null,
      patents,
      contractAwards,

      // Extracted in code from the crawl above. Every record here is checkable:
      // it names a person, a programme or a regulator, carries a date, and
      // points at the article it was read from.
      executiveMoves: executiveMoves.extract(news, company),
      strategicPrograms: strategicPrograms.extract(news, company),
      regulatoryActions: regulatoryActions.extract(news, company),

      // Kept for the scoring model, which reads headlines rather than records
      hiringSignals: jobDataFetcher.fetchHiringSignals(news),
    };
  }

  /**
   * Google News returns plenty of chaff for a common company name - unrelated
   * deals pages, aggregator noise, other firms' press. Anything that never
   * names the company is dropped, because the model will happily cite it.
   */
  isRelevant(article, company) {
    const text = `${article.title || ''} ${article.description || ''}`.toLowerCase();
    if (!text.trim()) return false;

    const name = String(company.name || '').toLowerCase().trim();
    if (name && text.includes(name)) return true;

    // Multi-word names also match on their distinctive leading word
    const lead = name.split(/\s+/)[0];
    if (lead && lead.length >= 5 && text.includes(lead)) return true;

    const ticker = String(company.ticker || '').toLowerCase().trim();
    return Boolean(ticker && ticker.length >= 3 && text.includes(ticker));
  }

  /**
   * The company's own numbers, as one citable source.
   *
   * These 20-odd fields were already being fetched for the report header but
   * never reached the model as evidence, so it could not say "revenue growth is
   * 9% against a debt/equity of 0.6" and cite it. One compact source is enough:
   * they are facts about a single moment, not separate documents.
   */
  financialSource(financial = {}, company = {}) {
    const num = (value, suffix = '', digits = 2) =>
      Number.isFinite(Number(value)) ? `${Number(value).toFixed(digits)}${suffix}` : null;

    const money = value => {
      const n = Number(value);
      if (!Number.isFinite(n)) return null;
      if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
      if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
      if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
      return `$${n.toLocaleString()}`;
    };

    const parts = [
      ['Market cap', money(financial.marketCap)],
      ['Share price', money(financial.currentPrice)],
      ['52-week range',
        money(financial.fiftyTwoWeekLow) && money(financial.fiftyTwoWeekHigh)
          ? `${money(financial.fiftyTwoWeekLow)}–${money(financial.fiftyTwoWeekHigh)}`
          : null],
      ['Revenue growth (TTM YoY)', num(financial.revenueGrowth, '%')],
      ['P/E (TTM)', num(financial.peRatio)],
      ['EPS (TTM)', num(financial.eps)],
      ['Return on equity', num(financial.roe, '%')],
      ['Debt/equity', num(financial.debtToEquity)],
      ['Current ratio', num(financial.currentRatio)],
      ['Industry', financial.industry],
      ['Exchange', financial.exchange],
      ['Country', financial.country],
    ].filter(([, value]) => value !== null && value !== undefined && value !== '');

    // Price alone is not worth a source slot - it says nothing about how the
    // business is doing, which is the only reason this is here.
    if (parts.length < 3) return null;

    return {
      title: `Financial snapshot — ${company.ticker || company.name || 'company'}`,
      description: parts.map(([label, value]) => `${label}: ${value}`).join('; '),
      url: financial.website || undefined,
      source: 'Finnhub / Yahoo Finance',
      publishedAt: financial.timestamp ? new Date(financial.timestamp) : new Date(),
      type: 'financial',
      reason: 'financial',
    };
  }

  /** The filed results, as their own source, so the results block can cite them. */
  resultsSource(financial = {}, company = {}) {
    const results = financial.latestResults;
    if (!results || (!results.revenue && !results.profit && !results.eps)) return null;

    const money = value => {
      const n = Number(value);
      if (!Number.isFinite(n)) return null;
      if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
      if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
      return `$${n.toLocaleString()}`;
    };

    const parts = [
      ['Revenue', money(results.revenue)],
      ['Net income', money(results.profit)],
      ['Diluted EPS', Number.isFinite(results.eps) ? `$${Number(results.eps).toFixed(2)}` : null],
      ['Share buybacks', money(results.buybackAmount)],
      ['Dividend per share',
        Number.isFinite(results.dividendPerShare) ? `$${Number(results.dividendPerShare).toFixed(2)}` : null],
    ].filter(([, value]) => value);

    if (!parts.length) return null;

    return {
      title: `${results.period || 'Latest'} reported results — ${company.name}`,
      description: parts.map(([label, value]) => `${label}: ${value}`).join('; '),
      url: results.url,
      source: results.source || 'SEC EDGAR',
      publishedAt: results.filedAt || results.periodEndedAt,
      type: 'filing',
      reason: 'earnings',
    };
  }

  /**
   * Build the numbered source list the AI cites against.
   *
   * Ordered by what the report leads with, not by where it came from. The
   * articles behind an extracted record are placed before general coverage so
   * that every verified record is guaranteed a citation - a programme the
   * report pins at the top of Key Insights cannot be the one claim with no
   * number next to it.
   */
  buildSources(evidence, company = {}) {
    const sources = [];
    let index = 1;

    const add = source => {
      if (!source) return null;
      const entry = { ...source, index };
      sources.push(entry);
      index += 1;
      return entry;
    };

    // First, so they are the lowest numbers: the model reaches for those, and
    // every other claim reads better anchored to the company's own figures.
    add(this.financialSource(evidence.financial, company));
    add(this.resultsSource(evidence.financial, company));

    // Articles behind a verified record, pinned and back-linked. The record
    // carries the source number it was given, which is how the renderers put a
    // citation on a line the model never wrote.
    const seenUrls = new Set(sources.map(s => s.url).filter(Boolean));

    const pin = (records, reason) => {
      records.forEach(record => {
        const article = record._article;
        if (!article?.url) return;

        const existing = sources.find(s => s.url === article.url);
        if (existing) {
          record.citations = [existing.index];
          return;
        }

        const entry = add({
          title: article.title,
          description: article.description,
          url: article.url,
          source: article.publisher || 'News',
          publishedAt: article.publishedAt ? new Date(article.publishedAt) : undefined,
          type: 'news',
          reason,
          originalPublisher: article.alsoCarriedBy?.length ? article.publisher : undefined,
        });

        record.citations = [entry.index];
        seenUrls.add(article.url);
      });
    };

    pin(evidence.strategicPrograms || [], 'program');
    pin(evidence.regulatoryActions || [], 'regulatory');
    pin(evidence.executiveMoves || [], 'people');

    // The rest of the coverage. Keyword-matched articles rank first so the
    // model reaches for what the seller is actually pitching.
    const relevant = evidence.news.filter(n => this.isRelevant(n, company));
    // If the filter is too aggressive for an obscure name, fall back to the raw
    // feed rather than handing the model nothing to work with
    const pool = relevant.length >= 5 ? relevant : evidence.news;

    if (relevant.length < evidence.news.length) {
      console.log(`🔎 Dropped ${evidence.news.length - relevant.length} off-topic articles of ${evidence.news.length}`);
    }

    const byRecency = (a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0);
    const remaining = pool.filter(article => article.url && !seenUrls.has(article.url));

    [...remaining.filter(n => n.matchedKeyword).sort(byRecency),
     ...remaining.filter(n => !n.matchedKeyword).sort(byRecency)]
      .slice(0, MAX_NEWS_SOURCES)
      .forEach(article => {
        if (!article.title) return;
        add({
          title: article.matchedKeyword
            ? `${article.title}  [matches: ${article.matchedKeyword}]`
            : article.title,
          description: article.description,
          url: article.url,
          source: article.publisher || 'News',
          publishedAt: article.publishedAt ? new Date(article.publishedAt) : undefined,
          type: 'news',
          reason: CITATION_REASONS[article.reason] ? article.reason : 'news',
          originalPublisher: article.alsoCarriedBy?.length ? article.publisher : undefined,
        });
      });

    // Already ranked by the fetcher, keyword-matching roles first
    (evidence.jobs || []).slice(0, MAX_JOB_SOURCES).forEach(job => {
      if (!job.title) return;
      const label = `${job.title}${job.location ? ` — ${job.location}` : ''}`;
      add({
        title: `Open role: ${label}${job.matchedKeyword ? `  [matches: ${job.matchedKeyword}]` : ''}`,
        description: job.description,
        url: job.url,
        source: job.source || 'Jobs',
        publishedAt: job.postedAt ? new Date(job.postedAt) : undefined,
        type: 'job',
        reason: 'job',
      });
    });

    // The hiring line cites whichever roles made it into the list
    const jobSources = sources.filter(s => s.type === 'job').map(s => s.index);
    if (evidence.hiring && jobSources.length) {
      evidence.hiring.citations = jobSources.slice(0, MAX_CITATIONS_PER_CLAIM);
    }

    (evidence.financial.secFilings || []).slice(0, MAX_FILING_SOURCES).forEach(filing => {
      add({
        title: `SEC filing ${filing.type || ''} ${filing.date || ''}`.trim(),
        // Populated by financialDataFetcher.enrichFilings - without it a filing
        // is a citable URL carrying no information
        description: filing.description,
        url: filing.url,
        source: 'SEC EDGAR',
        publishedAt: filing.date ? new Date(filing.date) : undefined,
        type: 'filing',
        reason: 'filing',
      });
    });

    // A transcript always has the speaker's name and title on record, which
    // makes it the best source in the report for an attributable quote
    (evidence.financial.transcripts || []).slice(0, MAX_TRANSCRIPT_SOURCES).forEach(transcript => {
      add({
        title: transcript.title,
        description: transcript.description,
        url: transcript.url,
        source: transcript.source,
        publishedAt: transcript.publishedAt,
        type: 'transcript',
        reason: 'transcript',
      });
    });

    (evidence.patents || []).slice(0, MAX_PATENT_SOURCES).forEach(patent => {
      const entry = add({
        title: `Patent: ${patent.title}`,
        description: `${patent.status === 'granted' ? 'Granted' : 'Filed'} to ${patent.applicant}` +
          `${patent.patentNumber ? ` — ${patent.patentNumber}` : ''}`,
        url: patent.url,
        source: 'USPTO',
        publishedAt: patent.grantedAt || patent.filedAt,
        type: 'patent',
        reason: 'patent',
      });
      if (entry) patent.citations = [entry.index];
    });

    (evidence.contractAwards || []).slice(0, MAX_CONTRACT_SOURCES).forEach(award => {
      const entry = add({
        title: `Federal award ${award.awardId || ''} — ${award.agency || ''}`.trim(),
        description: award.description,
        url: award.url,
        source: 'USAspending.gov',
        publishedAt: award.startedAt,
        type: 'contract',
        reason: 'contract',
      });
      if (entry) award.citations = [entry.index];
    });

    // The results block cites the filing it was read from
    const resultsSource = sources.find(s => s.reason === 'earnings');
    if (resultsSource && evidence.financial.latestResults) {
      evidence.financial.latestResults.citations = [resultsSource.index];
    }

    return sources;
  }

  /**
   * How well sourced this report actually is.
   *
   * A report written on nine sources and a report written on forty look
   * identical once they are formatted, which is precisely the problem: the thin
   * one reads as confident as the thorough one. This puts the number on the
   * face of the document.
   */
  buildCoverage(sources, stats = {}) {
    // By publisher, not by URL host: a Google News link points at
    // news.google.com, so counting hosts would report one domain for a report
    // written from thirty different outlets.
    const domains = new Set(
      sources
        .map(s => crawlService.publisherKey({ publisher: s.source, url: s.url }))
        .filter(Boolean)
    );

    const thin = sources.length < THIN_COVERAGE_FLOOR;

    return {
      sourceCount: sources.length,
      uniqueDomains: domains.size,
      articlesFetched: stats.articlesFetched || 0,
      duplicatesDropped: stats.duplicatesDropped || 0,
      thin,
      warning: thin
        ? `Thin coverage — this report was written from ${sources.length} source${sources.length === 1 ? '' : 's'} ` +
          `across ${domains.size} domain${domains.size === 1 ? '' : 's'}. ` +
          'Treat the conclusions as provisional and verify before using them in a client conversation.'
        : '',
    };
  }

  // Strip the extraction payload before storing: keep only the fields the UI needs
  toStoredSources(sources) {
    return sources.map(s => ({
      index: s.index,
      title: s.title,
      url: s.url,
      source: s.source,
      publishedAt: s.publishedAt,
      type: s.type,
      reason: s.reason,
      originalPublisher: s.originalPublisher,
    }));
  }

  /** Drop the raw article each record was extracted from before it is stored. */
  toStoredRecords(records = []) {
    return records.map(({ _article, ...rest }) => rest);
  }

  // ---- main pipeline -----------------------------------------------------

  /**
   * @param {object} opts
   * @param {object} opts.company  prospect document
   * @param {object} opts.seller   organization.toSellerContext() - the only lens
   * @param {object} [opts.crm]     CrmRecord.toContext(), when a CRM is connected
   * @param {function} [opts.onProgress] (step, percent) => void
   */
  async buildIntelligence({ company, seller, crm = null, onProgress = () => {} }) {
    // High-priority topics first, so the evidence search leans the same way the
    // prompt does rather than pulling news for incidental subjects.
    const keywords = [
      ...(seller.priorityTopics || []),
      ...(seller.standardTopics || []),
      ...(seller.priorityTopics?.length || seller.standardTopics?.length ? [] : seller.capabilities || []),
    ].filter(Boolean);

    onProgress('Crawling news, filings, hiring and public records', 10);
    const evidence = await this.gather(company, keywords);

    onProgress('Scoring account fit', 25);
    const score = scoreAccount({
      company,
      news: evidence.news,
      jobs: evidence.jobs,
      seller,
      crm,
    });

    // Numbering the sources also writes the citation back onto every extracted
    // record, so this has to happen before anything renders them
    const sources = this.buildSources(evidence, company);
    const coverage = this.buildCoverage(sources, evidence.crawlStats);

    if (coverage.thin) {
      console.warn(`⚠️ Thin coverage for ${company.name}: ${coverage.sourceCount} sources`);
    }

    const prospect = {
      name: company.name,
      ticker: company.ticker,
      industry: company.industry,
      country: company.country,
      employees: company.employees,
      website: company.website,
      description: company.description,
      financials: {
        ...(company.financials?.toObject?.() || company.financials || {}),
        ...evidence.financial,
      },
    };

    // The verified records are handed to every pass as established fact, so the
    // model builds on them and never contradicts or re-derives them
    const context = aiEngine.buildContext({ seller, prospect, crm, evidence });

    // The brief is generated first because the value section builds on it. The
    // other passes are independent, so they ride alongside it.
    onProgress('Analysing signals against your pitch', 40);
    const [brief, research, strategy, whitespace] = await Promise.all([
      aiEngine.generateExecutiveBrief(context, sources),
      aiEngine.generateResearch(context, sources),
      aiEngine.generateStrategy(context, sources),
      // Only worth a call when there is something to read direction from
      (evidence.patents?.length || evidence.contractAwards?.length)
        ? aiEngine.generateWhitespace(context, sources, evidence)
        : Promise.resolve({}),
    ]);

    onProgress('Building the value story', 75);
    const [value, scoreSummary] = await Promise.all([
      aiEngine.generateValue(context, sources, brief),
      aiEngine.summariseScore(context, score),
    ]);

    onProgress('Assembling report', 90);

    return {
      score: { ...score, summary: scoreSummary },
      sources: this.toStoredSources(sources),
      coverage,
      evidence,
      prospect,

      // What the renderers draw directly, with no model in the path
      records: {
        executiveMoves: this.toStoredRecords(evidence.executiveMoves),
        strategicPrograms: this.toStoredRecords(evidence.strategicPrograms),
        regulatoryActions: this.toStoredRecords(evidence.regulatoryActions),
        patents: evidence.patents || [],
        contractAwards: evidence.contractAwards || [],
        hiring: evidence.hiring || undefined,
        latestResults: evidence.financial.latestResults || undefined,
      },

      sections: this.assemble({
        brief, research, strategy, value, whitespace, evidence, sources,
      }),
    };
  }

  // Normalise the AI payloads into the Report document shape
  assemble({ brief = {}, research = {}, strategy = {}, value = {}, whitespace = {}, evidence, sources }) {
    const sourceByIndex = new Map(sources.map(s => [s.index, s]));

    // Prefer the model's curated headlines, but fall back to raw articles so the
    // section is never empty when the model omits it.
    const topNews = (Array.isArray(brief.topNews) ? brief.topNews : [])
      .map(item => {
        if (typeof item === 'string') return { title: item, citations: [] };
        if (!item?.title) return null;
        return {
          title: String(item.title).trim(),
          summary: item.summary ? String(item.summary).trim() : undefined,
          source: item.source,
          url: item.url,
          publishedAt: item.publishedAt ? new Date(item.publishedAt) : undefined,
          citations: this.toCitations(item.citations),
        };
      })
      .filter(Boolean)
      .slice(0, 6);

    // Repair URLs the model hallucinated by pulling them from the cited source
    topNews.forEach(item => {
      const cited = item.citations?.map(i => sourceByIndex.get(i)).find(Boolean);
      if (cited) {
        if (!item.url || !/^https?:\/\//.test(item.url)) item.url = cited.url;
        if (!item.source) item.source = cited.source;
        if (!item.publishedAt) item.publishedAt = cited.publishedAt;
      }
    });

    const fallbackNews = evidence.news.slice(0, 5).map((article, i) => ({
      title: article.title,
      summary: (article.description || '').replace(/<[^>]*>/g, '').slice(0, 240),
      source: article.publisher || 'News',
      url: article.url,
      publishedAt: article.publishedAt ? new Date(article.publishedAt) : undefined,
      citations: [i + 1],
    }));

    const executivePerspective = this.cleanQuotes(brief.executivePerspective, sources);

    const valueProps = (Array.isArray(value.valuePropositions) ? value.valuePropositions : [])
      .map((p, i) => {
        if (typeof p === 'string') return { title: `Value point ${i + 1}`, body: p, citations: [] };
        if (!p?.body && !p?.text) return null;
        return {
          title: p.title || `Value point ${i + 1}`,
          body: String(p.body || p.text).trim(),
          citations: this.toCitations(p.citations),
        };
      })
      .filter(Boolean)
      .slice(0, 7);

    return {
      executiveBrief: {
        keyInsights: this.toInsights(brief.keyInsights, 8),
        opportunities: this.toInsights(brief.opportunities, 6),
        challenges: this.toInsights(brief.challenges, 5),
        // The verified moves are rendered above these from the records; what
        // the model adds here is the reading of them, not the roster
        peopleUpdates: this.toInsights(brief.peopleUpdates, 4),
        talkingPoints: this.toTalkingPoints(brief.talkingPoints, 6),
        topNews: topNews.length ? topNews : fallbackNews,
        executivePerspective,
      },

      research: {
        companyOverview: this.toInsights(research.companyOverview, 4),
        keyPeopleChanges: this.toInsights(research.keyPeopleChanges, 4),
        keyProjects: this.toInsights(research.keyProjects, 5),
        aspirations: this.toInsights(research.aspirations, 4),
        businessGoals: this.toInsights(research.businessGoals, 4),
        opportunities: this.toInsights(research.opportunities || strategy.swot?.opportunities, 4),
        macroPerspective: this.toInsights(research.macroPerspective, 4),
        recentPress: this.toInsights(research.recentPress, 5),
        businessModel: {
          revenueStreams: this.toInsights(strategy.businessModel?.revenueStreams, 3),
          goToMarket: this.toInsights(strategy.businessModel?.goToMarket, 3),
          idealCustomerProfile: this.toInsights(strategy.businessModel?.idealCustomerProfile, 3),
        },
        strategicInitiatives: this.toInsights(strategy.strategicInitiatives, 5),
        financials: this.toInsights(strategy.financials, 4),
        swot: {
          strengths: this.toInsights(strategy.swot?.strengths, 4),
          weaknesses: this.toInsights(strategy.swot?.weaknesses, 3),
          opportunities: this.toInsights(strategy.swot?.opportunities, 5),
          threats: this.toInsights(strategy.swot?.threats, 3),
        },
      },

      value: {
        whyChange: this.toInsights(value.whyChange, 5),
        whyNow: this.toInsights(value.whyNow, 5),
        whyYou: this.toInsights(value.whyYou, 5),
        valuePyramid: {
          companyGoals: this.toInsights(value.valuePyramid?.companyGoals, 3),
          businessStrategy: this.toInsights(value.valuePyramid?.businessStrategy, 3),
          challengesObstacles: this.toInsights(value.valuePyramid?.challengesObstacles, 4),
          valuePaths: this.toInsights(value.valuePyramid?.valuePaths, 6),
        },
        valuePropositions: valueProps,
        hypotheses: this.toInsights(value.hypotheses, 5),
        pointOfView: this.toInsights(value.pointOfView, 5),
      },

      whitespace: {
        insights: this.toInsights(whitespace.insights, 5),
        capabilityGaps: this.toInsights(whitespace.capabilityGaps, 4),
      },
    };
  }
}

module.exports = new IntelligenceService();
module.exports.CITATION_REASONS = CITATION_REASONS;
module.exports.THIN_COVERAGE_FLOOR = THIN_COVERAGE_FLOOR;
