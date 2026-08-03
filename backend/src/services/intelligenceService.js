const aiEngine = require('./aiEngine');
const { scoreAccount } = require('./scoring');
const newsDataFetcher = require('./dataFetchers/newsDataFetcher');
const financialDataFetcher = require('./dataFetchers/financialDataFetcher');
const jobDataFetcher = require('./dataFetchers/jobDataFetcher');

// Orchestrates one report: gather evidence -> number the sources -> score the
// account -> run the four AI passes -> normalise everything into the Report shape.
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
   * The quote section is the one place the model is told to return nothing when
   * it finds nothing - and the one place it reliably ignores that, emitting
   * "No verbatim quotes are available" as if it were a quote. Those, and any
   * quote without a named speaker or repeated verbatim, are dropped: a fake
   * quote in a client-facing brief is worse than an absent section.
   */
  cleanQuotes(value) {
    const REFUSALS = [
      'no verbatim', 'no quote', 'no direct quote', 'not available', 'none available',
      'no executive', 'could not find', 'unavailable', 'no statements', 'n/a',
    ];

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
        if (!person || /^(company )?(spokesperson|executive|unknown|n\/a)$/i.test(person)) return null;

        return {
          quote,
          person,
          title: (typeof q === 'object' && q.title) || '',
          source: (typeof q === 'object' && q.source) || '',
          citations: this.toCitations(typeof q === 'object' ? q.citations : []),
        };
      })
      .filter(Boolean)
      .slice(0, 4);
  }

  toCitations(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map(n => Number(n))
      .filter(n => Number.isInteger(n) && n > 0)
      .slice(0, 6);
  }

  // ---- evidence gathering ------------------------------------------------

  async gather(company, keywords) {
    const [news, financial, jobsData] = await Promise.all([
      newsDataFetcher.fetchNews(company.name, company.ticker, keywords).catch(() => []),
      company.ticker
        ? financialDataFetcher.fetchFinancialData(company.ticker).catch(() => ({}))
        : Promise.resolve({}),
      jobDataFetcher.fetchJobData(company.name).catch(() => ({ openPositions: [] })),
    ]);

    return {
      news,
      financial: financial || {},
      jobs: jobsData?.openPositions || [],
      executiveMoves: jobDataFetcher.parseExecutiveAppointments(news),
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
   * Build the numbered source list the AI cites against.
   * Keyword-matched articles are ranked first so the model reaches for them.
   */
  buildSources({ news, jobs, financial }, company = {}) {
    const sources = [];
    let index = 1;

    const relevant = news.filter(n => this.isRelevant(n, company));
    // If the filter is too aggressive for an obscure name, fall back to the raw
    // feed rather than handing the model nothing to work with
    const pool = relevant.length >= 5 ? relevant : news;

    if (relevant.length < news.length) {
      console.log(`🔎 Dropped ${news.length - relevant.length} off-topic articles of ${news.length}`);
    }

    const keywordMatched = pool.filter(n => n.matchedKeyword);
    const rest = pool.filter(n => !n.matchedKeyword);

    const byRecency = (a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0);

    [...keywordMatched.sort(byRecency), ...rest.sort(byRecency)]
      .slice(0, 26)
      .forEach(article => {
        if (!article.title) return;
        sources.push({
          index: index++,
          title: article.matchedKeyword
            ? `${article.title}  [matches: ${article.matchedKeyword}]`
            : article.title,
          description: article.description,
          url: article.url,
          source: article.source?.name || article.source || 'News',
          publishedAt: article.publishedAt ? new Date(article.publishedAt) : undefined,
          type: 'news',
        });
      });

    jobs.slice(0, 8).forEach(job => {
      if (!job.title) return;
      sources.push({
        index: index++,
        title: `Open role: ${job.title}${job.location ? ` — ${job.location}` : ''}`,
        description: job.description,
        url: job.url,
        source: job.source || 'Jobs',
        type: 'job',
      });
    });

    (financial.secFilings || []).slice(0, 4).forEach(filing => {
      sources.push({
        index: index++,
        title: `SEC filing ${filing.type || ''} ${filing.date || ''}`.trim(),
        url: filing.url,
        source: 'SEC EDGAR',
        publishedAt: filing.date ? new Date(filing.date) : undefined,
        type: 'filing',
      });
    });

    return sources;
  }

  // Strip the citation payload before storing: keep only the fields the UI needs
  toStoredSources(sources) {
    return sources.map(s => ({
      index: s.index,
      title: s.title,
      url: s.url,
      source: s.source,
      publishedAt: s.publishedAt,
      type: s.type,
    }));
  }

  // ---- main pipeline -----------------------------------------------------

  /**
   * @param {object} opts
   * @param {object} opts.company  prospect document
   * @param {object} opts.seller   organization.toSellerContext()
   * @param {object} opts.profile  user.toSellerProfile(overrideKeywords)
   * @param {function} [opts.onProgress] (step, percent) => void
   */
  async buildIntelligence({ company, seller, profile, onProgress = () => {} }) {
    const keywords = profile.keywords || [];

    onProgress('Gathering news, filings and hiring data', 10);
    const evidence = await this.gather(company, keywords);

    onProgress('Scoring account fit', 25);
    const score = scoreAccount({
      company,
      news: evidence.news,
      jobs: evidence.jobs,
      profile,
      seller,
    });

    const sources = this.buildSources(evidence, company);

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

    const context = aiEngine.buildContext({ seller, profile, prospect });

    // The brief is generated first because the value section builds on it. The
    // two research passes are independent, so they ride alongside it.
    onProgress('Analysing signals against your pitch', 40);
    const [brief, research, strategy] = await Promise.all([
      aiEngine.generateExecutiveBrief(context, sources),
      aiEngine.generateResearch(context, sources),
      aiEngine.generateStrategy(context, sources),
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
      evidence,
      prospect,
      sections: this.assemble({ brief, research, strategy, value, evidence, sources }),
    };
  }

  // Normalise the four AI payloads into the Report document shape
  assemble({ brief = {}, research = {}, strategy = {}, value = {}, evidence, sources }) {
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
      source: article.source?.name || 'News',
      url: article.url,
      publishedAt: article.publishedAt ? new Date(article.publishedAt) : undefined,
      citations: [i + 1],
    }));

    const executivePerspective = this.cleanQuotes(brief.executivePerspective);

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
        peopleUpdates: this.toInsights(brief.peopleUpdates, 4),
        talkingPoints: this.toInsights(brief.talkingPoints, 5),
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
    };
  }
}

module.exports = new IntelligenceService();
