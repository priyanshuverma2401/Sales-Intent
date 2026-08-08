const axios = require('axios');
const { convert } = require('html-to-text');

// SEC requires a descriptive User-Agent with contact details on every request
const SEC_HEADERS = {
  'User-Agent': process.env.SEC_USER_AGENT || 'SalesMotion/1.0 (support@salesmotion.local)',
  'Accept-Encoding': 'gzip, deflate',
};

// How many of the most recent filings get their text pulled down, and how much
// of each is kept. A 10-K runs to several megabytes, so only the leading prose
// is taken - by then the filing has said what it was filed to say.
// Read explicitly rather than with `|| default` so SEC_ENRICH_FILINGS=0 means
// "skip the fetch" instead of silently falling back to 5.
function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

const ENRICH_FILINGS = envInt('SEC_ENRICH_FILINGS', 5);
const FILING_EXCERPT_CHARS = envInt('SEC_EXCERPT_CHARS', 3000);

class FinancialDataFetcher {
  constructor() {
    // ticker -> CIK map from SEC, fetched once and reused
    this.cikCache = null;
  }

  // Fetch from Finnhub API
  async fetchFromFinnhub(ticker) {
    if (!process.env.FINNHUB_API_KEY) {
      console.warn('⚠️ Finnhub API not configured');
      return null;
    }

    const token = process.env.FINNHUB_API_KEY;

    try {
      // /quote only returns current/open/high/low/previous-close. Market cap and
      // 52-week range live on /stock/profile2 and /stock/metric respectively -
      // reading them off /quote (as this used to) always yielded undefined.
      const [quote, profile, metrics] = await Promise.all([
        axios.get('https://finnhub.io/api/v1/quote', {
          params: { symbol: ticker, token },
          timeout: 8000,
        }).catch(e => { console.error('❌ Finnhub quote error:', e.message); return null; }),
        axios.get('https://finnhub.io/api/v1/stock/profile2', {
          params: { symbol: ticker, token },
          timeout: 8000,
        }).catch(e => { console.error('❌ Finnhub profile error:', e.message); return null; }),
        axios.get('https://finnhub.io/api/v1/stock/metric', {
          params: { symbol: ticker, metric: 'all', token },
          timeout: 8000,
        }).catch(e => { console.error('❌ Finnhub metric error:', e.message); return null; }),
      ]);

      const q = quote?.data || {};
      const p = profile?.data || {};
      const m = metrics?.data?.metric || {};

      if (!q.c && !p.ticker) return null;

      return {
        currentPrice: q.c,
        dayHigh: q.h,
        dayLow: q.l,
        openPrice: q.o,
        previousClose: q.pc,
        // Finnhub reports market cap in millions
        marketCap: p.marketCapitalization ? p.marketCapitalization * 1e6 : undefined,
        fiftyTwoWeekHigh: m['52WeekHigh'],
        fiftyTwoWeekLow: m['52WeekLow'],
        peRatio: m.peTTM,
        eps: m.epsTTM,
        roe: m.roeTTM,
        currentRatio: m.currentRatioQuarterly,
        debtToEquity: m['totalDebt/totalEquityQuarterly'],
        revenueGrowth: m.revenueGrowthTTMYoy,
        industry: p.finnhubIndustry,
        website: p.weburl,
        logo: p.logo,
        country: p.country,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error('❌ Finnhub error:', error.message);
    }

    return null;
  }

  // Fetch from Yahoo Finance.
  // The v10 quoteSummary endpoint now demands a crumb/cookie pair and returns
  // 401 to anonymous callers; the v8 chart endpoint still serves the same price
  // fields without authentication.
  async fetchFromYahooFinance(ticker) {
    try {
      const response = await axios.get(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`,
        {
          params: { interval: '1d', range: '1d' },
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 8000,
        }
      );

      const meta = response.data?.chart?.result?.[0]?.meta;
      if (!meta) return null;

      return {
        currentPrice: meta.regularMarketPrice,
        dayHigh: meta.regularMarketDayHigh,
        dayLow: meta.regularMarketDayLow,
        previousClose: meta.previousClose ?? meta.chartPreviousClose,
        fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
        volume: meta.regularMarketVolume,
        currency: meta.currency,
        exchange: meta.fullExchangeName,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error('❌ Yahoo Finance error:', error.message);
    }

    return null;
  }

  // Resolve a ticker to its SEC CIK number.
  // Previously every lookup used a hardcoded CIK (Microsoft's), so all companies
  // reported Microsoft's filings.
  async resolveCik(ticker) {
    if (!ticker) return null;

    try {
      if (!this.cikCache) {
        const response = await axios.get('https://www.sec.gov/files/company_tickers.json', {
          headers: SEC_HEADERS,
          timeout: 10000,
        });

        this.cikCache = new Map(
          Object.values(response.data).map(entry => [
            String(entry.ticker).toUpperCase(),
            String(entry.cik_str).padStart(10, '0'),
          ])
        );
      }

      return this.cikCache.get(String(ticker).toUpperCase()) || null;
    } catch (error) {
      console.error('❌ SEC CIK lookup error:', error.message);
      return null;
    }
  }

  // Fetch SEC EDGAR filings for this specific ticker
  async fetchSecFilings(ticker) {
    try {
      const cik = await this.resolveCik(ticker);
      if (!cik) {
        console.warn(`⚠️ No SEC CIK found for ${ticker}`);
        return [];
      }

      const response = await axios.get(`https://data.sec.gov/submissions/CIK${cik}.json`, {
        headers: SEC_HEADERS,
        timeout: 10000,
      });

      const recent = response.data?.filings?.recent;
      if (!recent?.form) return [];

      // EDGAR returns parallel arrays, one entry per filing
      const filings = [];
      for (let i = 0; i < recent.form.length && filings.length < 10; i++) {
        if (!['10-K', '10-Q', '8-K'].includes(recent.form[i])) continue;

        const accession = recent.accessionNumber[i];
        filings.push({
          type: recent.form[i],
          date: recent.filingDate[i],
          accessionNumber: accession,
          url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}/${recent.primaryDocument[i]}`,
        });
      }

      return this.enrichFilings(filings);
    } catch (error) {
      console.error('❌ SEC EDGAR error:', error.message);
    }

    return [];
  }

  /**
   * Pull the actual text of the most recent filings.
   *
   * Without this a filing reaches the model as "SEC filing 8-K 2025-01-15" and
   * a URL - citable, but carrying no information. What a company told the SEC
   * about its own risks and spending is the highest-quality evidence in the
   * report, and it was being thrown away.
   *
   * Only the newest few are fetched: the documents are large, and a 10-K from
   * three years ago says nothing about this quarter's buying intent.
   */
  async enrichFilings(filings) {
    if (ENRICH_FILINGS < 1) return filings;

    const enriched = await Promise.all(
      filings.slice(0, ENRICH_FILINGS).map(async filing => {
        try {
          const response = await axios.get(filing.url, {
            headers: SEC_HEADERS,
            timeout: 12000,
            maxContentLength: 25 * 1024 * 1024,
            responseType: 'text',
            transformResponse: [data => data],
          });

          const description = this.extractFilingText(String(response.data || ''));
          return description ? { ...filing, description } : filing;
        } catch (error) {
          // One unreachable document must not cost the report its filings
          return filing;
        }
      })
    );

    const withText = enriched.filter(f => f.description).length;
    console.log(`📄 Extracted text from ${withText}/${enriched.length} SEC filings`);

    return [...enriched, ...filings.slice(ENRICH_FILINGS)];
  }

  /**
   * Turn filing HTML into the prose worth citing.
   *
   * Everything before the first numbered "Item" is cover page - addresses,
   * checkbox declarations, the registrant's phone number - so the excerpt
   * starts there when one can be found. Tables of XBRL figures survive
   * conversion as walls of digits and are stripped, since the numbers already
   * arrive cleanly from Finnhub.
   */
  extractFilingText(html) {
    if (!html) return '';

    let text = convert(html, {
      wordwrap: false,
      selectors: [
        { selector: 'a', options: { ignoreHref: true } },
        { selector: 'img', format: 'skip' },
        { selector: 'table', format: 'skip' },
      ],
    });

    const item = text.search(/\bItem\s+\d+(\.\d+)?[.\s—-]/i);
    if (item > 0) text = text.slice(item);

    text = text
      .replace(/\s+/g, ' ')
      // Runs of bare figures left behind by stripped tables
      .replace(/(?:\b[\d,.()$%-]+\b\s*){6,}/g, ' ')
      .trim();

    return text.length < 200 ? '' : text.slice(0, FILING_EXCERPT_CHARS);
  }

  // =========================================================================
  // Latest reported results
  //
  // The report used to show market cap and a revenue-growth percentage, which
  // says nothing a rep can open with. "H1 2026: $4.8B profit, up 10%, $1B
  // buyback announced" does - but only if every figure in it is real, so all of
  // them come from a filing rather than from a model.
  //
  // SEC XBRL is the primary source for anything US-listed: the numbers are the
  // ones the company filed, each carries the period it belongs to and the
  // accession number of the filing it came from, and the whole thing is free
  // and keyless. Finnhub fills in the earnings date; the IR page covers
  // companies EDGAR does not.
  // =========================================================================

  /**
   * One XBRL concept - a single line item across every period the company has
   * filed. Each concept is its own small request, which is why only the handful
   * that make up the results line are asked for.
   */
  async fetchConcept(cik, tag, taxonomy = 'us-gaap') {
    try {
      const { data } = await axios.get(
        `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/${taxonomy}/${tag}.json`,
        { headers: SEC_HEADERS, timeout: 10000 }
      );

      // Companies report in their own currency; USD is the common case and the
      // only unit the report can safely compare against anything else
      const units = data?.units?.USD || data?.units?.['USD/shares'] || [];
      return Array.isArray(units) ? units : [];
    } catch (error) {
      // A tag the company does not use returns 404 - normal, not a failure
      return [];
    }
  }

  /**
   * The most recently filed value for a concept.
   *
   * XBRL carries every restatement and every prior-period comparative, so the
   * newest filing date wins rather than the newest period: a 10-Q filed today
   * restating last year is not this quarter's result.
   *
   * `quarterly` picks entries covering about a quarter; without it the annual
   * figures are taken. Instantaneous facts (a share count) have no start date
   * and are matched on their own.
   */
  latestFact(entries, { quarterly = true } = {}) {
    const days = entry => {
      if (!entry.start || !entry.end) return 0;
      return (new Date(entry.end) - new Date(entry.start)) / 86400000;
    };

    const candidates = entries.filter(entry => {
      if (!entry.end || entry.val === undefined || entry.val === null) return false;
      if (!['10-Q', '10-K', '20-F', '40-F', '6-K'].includes(entry.form)) return false;

      const span = days(entry);
      // A quarter is 85-95 days; a half year 175-190. Both are "latest results"
      // - which one a company reports is a matter of where it is listed.
      return quarterly ? span > 60 && span < 200 : span >= 300;
    });

    if (!candidates.length) return null;

    return candidates.sort((a, b) =>
      new Date(b.filed || 0) - new Date(a.filed || 0) ||
      new Date(b.end || 0) - new Date(a.end || 0)
    )[0];
  }

  /** "Q2 2026" / "H1 2026" / "FY2025", from what the company itself labelled it. */
  periodLabel(fact) {
    if (!fact) return '';

    const year = fact.fy || (fact.end ? new Date(fact.end).getFullYear() : '');
    const span = fact.start && fact.end
      ? (new Date(fact.end) - new Date(fact.start)) / 86400000
      : 0;

    if (span > 150) return `H1 ${year}`;
    if (fact.fp && fact.fp !== 'FY') return `${fact.fp} ${year}`;
    if (span >= 300) return `FY${year}`;
    return year ? `${year}` : '';
  }

  /**
   * Revenue, profit, EPS, dividend and buyback for the latest reported period.
   *
   * Returns null when nothing could be read. That is a real answer - the report
   * then shows no results block rather than an estimated one.
   */
  async fetchLatestResults(ticker) {
    const cik = await this.resolveCik(ticker);
    if (!cik) return null;

    // Revenue is filed under whichever tag the company's accountants chose, so
    // the common ones are tried in order of how specific they are
    const [
      revenueNew, revenueOld, netIncome, eps, buyback, dividend,
    ] = await Promise.all([
      this.fetchConcept(cik, 'RevenueFromContractWithCustomerExcludingAssessedTax'),
      this.fetchConcept(cik, 'Revenues'),
      this.fetchConcept(cik, 'NetIncomeLoss'),
      this.fetchConcept(cik, 'EarningsPerShareDiluted'),
      this.fetchConcept(cik, 'PaymentsForRepurchaseOfCommonStock'),
      this.fetchConcept(cik, 'CommonStockDividendsPerShareDeclared'),
    ]);

    const revenueFact = this.latestFact(revenueNew) || this.latestFact(revenueOld);
    const profitFact = this.latestFact(netIncome);
    const epsFact = this.latestFact(eps);
    const buybackFact = this.latestFact(buyback);
    const dividendFact = this.latestFact(dividend);

    // Whichever line item is most recent decides the period the block is
    // labelled with - they are all filed together
    const anchor = revenueFact || profitFact || epsFact;
    if (!anchor) return null;

    const filingUrl = anchor.accn
      ? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${anchor.accn.replace(/-/g, '')}/`
      : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=10-Q`;

    // Only figures from the same period as the anchor are shown together - a
    // buyback from two years ago has no business in this quarter's line
    const samePeriod = fact => fact && fact.end === anchor.end;

    return {
      period: this.periodLabel(anchor),
      periodEndedAt: anchor.end ? new Date(anchor.end) : undefined,
      revenue: samePeriod(revenueFact) ? revenueFact.val : undefined,
      profit: samePeriod(profitFact) ? profitFact.val : undefined,
      eps: samePeriod(epsFact) ? epsFact.val : undefined,
      buybackAmount: samePeriod(buybackFact) ? buybackFact.val : undefined,
      dividendPerShare: samePeriod(dividendFact) ? dividendFact.val : undefined,
      currency: 'USD',
      url: filingUrl,
      source: `SEC EDGAR (${anchor.form})`,
      filedAt: anchor.filed ? new Date(anchor.filed) : undefined,
    };
  }

  /**
   * When the company last reported, and what it earned against expectations.
   *
   * Finnhub's free tier serves this; the transcript endpoint that would confirm
   * the figures in the CFO's own words is a paid add-on, so it is only called
   * when the plan is known to carry it.
   */
  async fetchEarningsContext(ticker) {
    if (!process.env.FINNHUB_API_KEY) return {};

    const token = process.env.FINNHUB_API_KEY;

    try {
      const { data } = await axios.get('https://finnhub.io/api/v1/stock/earnings', {
        params: { symbol: ticker, token },
        timeout: 8000,
      });

      const latest = (Array.isArray(data) ? data : [])
        .filter(entry => entry?.period)
        .sort((a, b) => new Date(b.period) - new Date(a.period))[0];

      if (!latest) return {};

      return {
        lastEarningsAt: new Date(latest.period),
        epsActual: latest.actual,
        epsEstimate: latest.estimate,
      };
    } catch (error) {
      return {};
    }
  }

  /**
   * Earnings-call transcripts.
   *
   * The cleanest source in the whole pipeline for a named programme or an
   * attributable quote - a transcript always carries the speaker's name and
   * title on the record. It is a paid Finnhub endpoint, so this stays dormant
   * until FINNHUB_PREMIUM says the plan covers it; every caller treats an empty
   * result as "no transcript", which is what a free plan returns anyway.
   */
  async fetchTranscripts(ticker) {
    if (process.env.FINNHUB_PREMIUM !== 'true' || !process.env.FINNHUB_API_KEY) return [];

    const token = process.env.FINNHUB_API_KEY;

    try {
      const { data } = await axios.get('https://finnhub.io/api/v1/stock/transcripts/list', {
        params: { symbol: ticker, token },
        timeout: 10000,
      });

      const recent = (data?.transcripts || []).slice(0, 2);

      const full = await Promise.all(
        recent.map(async entry => {
          try {
            const { data: detail } = await axios.get('https://finnhub.io/api/v1/stock/transcripts', {
              params: { id: entry.id, token },
              timeout: 12000,
            });

            // Opening remarks are where a programme gets named and the headline
            // figures are read out, with the speaker on record for both
            const speech = (detail?.transcript || [])
              .slice(0, 6)
              .map(part => `${part.name}${part.speech ? `: ${part.speech.join(' ')}` : ''}`)
              .join('\n')
              .slice(0, 4000);

            return {
              title: `${entry.title || 'Earnings call'} — ${entry.symbol || ticker}`,
              description: speech,
              url: `https://finnhub.io/`,
              publishedAt: entry.time ? new Date(entry.time) : undefined,
              source: 'Earnings call transcript',
              type: 'transcript',
            };
          } catch (_) {
            return null;
          }
        })
      );

      return full.filter(Boolean);
    } catch (error) {
      // 403 is the expected answer on a free plan
      return [];
    }
  }

  /**
   * EDGAR full-text search - filings that mention the company by name.
   *
   * Complements the submissions feed, which only returns filings the company
   * itself made. A named programme or a contract often appears in an exhibit
   * this finds and that one does not.
   */
  async searchFilings(companyName, forms = '10-Q,10-K,8-K') {
    if (!companyName) return [];

    try {
      const { data } = await axios.get('https://efts.sec.gov/LATEST/search-index', {
        params: { q: `"${companyName}"`, forms },
        headers: SEC_HEADERS,
        timeout: 12000,
      });

      return (data?.hits?.hits || []).slice(0, 5).map(hit => {
        // "0001558370-25-006294:nclh-20250331x10q.htm"
        const [accession, document] = String(hit._id || '').split(':');
        const cik = hit._source?.ciks?.[0];

        return {
          type: hit._source?.file_type || hit._source?.root_form,
          date: hit._source?.file_date,
          url: cik && accession
            ? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}/${document || ''}`
            : undefined,
          description: hit._source?.display_names?.join(', '),
        };
      }).filter(filing => filing.url);
    } catch (error) {
      return [];
    }
  }

  /**
   * Headline figures off the company's own investor-relations page.
   *
   * The fallback for companies EDGAR does not cover - anything listed outside
   * the US. Only figures written next to a results word are taken, and the
   * period is only claimed when the page states one; a number lifted from a
   * page's navigation is not a result.
   */
  async fetchFromInvestorRelations(url) {
    if (!url) return null;

    try {
      const { data } = await axios.get(url, {
        headers: { 'User-Agent': SEC_HEADERS['User-Agent'] },
        timeout: 12000,
        maxContentLength: 8 * 1024 * 1024,
        responseType: 'text',
        transformResponse: [d => d],
      });

      const text = convert(String(data || ''), {
        wordwrap: false,
        selectors: [
          { selector: 'a', options: { ignoreHref: true } },
          { selector: 'img', format: 'skip' },
          { selector: 'nav', format: 'skip' },
        ],
      }).replace(/\s+/g, ' ').trim();

      if (text.length < 200) return null;

      const period = /\b((?:Q[1-4]|H[12]|FY)\s?20\d{2}|(?:first|second|third|fourth)[\s-]quarter\s+20\d{2}|(?:full|half)[\s-]year\s+20\d{2})\b/i
        .exec(text)?.[1];

      // A currency figure sitting next to a results word, which is the only
      // context that makes it this period's result rather than any other number
      const money = /(?:revenue|profit|earnings|income|turnover)[^.]{0,60}?([$£€¥]\s?\d[\d,.]*\s?(?:billion|bn|million|mn|trillion|tn)?)/i
        .exec(text)?.[1];

      const buyback = /((?:[$£€¥]\s?\d[\d,.]*\s?(?:billion|bn|million|mn)?)[^.]{0,30}?(?:buyback|share repurchase|repurchase programme|repurchase program))/i
        .exec(text)?.[1];

      if (!period && !money) return null;

      return {
        period: period ? period.toUpperCase().replace(/\s+/g, ' ') : '',
        headlineFigure: money || '',
        buyback: buyback || '',
        url,
        source: 'Investor relations',
      };
    } catch (error) {
      return null;
    }
  }

  // Main financial data fetch
  async fetchFinancialData(ticker, company = {}) {
    if (!ticker && !company?.pages?.investorRelationsUrl) return {};

    console.log(`💰 Fetching financial data for ${ticker || company.name}`);

    // Companies with no ticker can still have an IR page worth reading
    if (!ticker) {
      const ir = await this.fetchFromInvestorRelations(company.pages.investorRelationsUrl);
      return ir ? { investorRelations: ir } : {};
    }

    let financialData = {};

    const [finnhubData, yahooData, secFilings] = await Promise.all([
      this.fetchFromFinnhub(ticker),
      this.fetchFromYahooFinance(ticker),
      this.fetchSecFilings(ticker),
    ]);

    // The results block, its earnings date, and the sources that back both.
    // Each is independently optional: a company can be well covered by EDGAR
    // and absent from Finnhub, or the other way round.
    const [results, earnings, transcripts, fullText, ir] = await Promise.all([
      this.fetchLatestResults(ticker).catch(() => null),
      this.fetchEarningsContext(ticker).catch(() => ({})),
      this.fetchTranscripts(ticker).catch(() => []),
      this.searchFilings(company.name).catch(() => []),
      this.fetchFromInvestorRelations(company?.pages?.investorRelationsUrl).catch(() => null),
    ]);

    if (results || earnings?.lastEarningsAt || ir) {
      financialData.latestResults = {
        ...(results || {}),
        ...(earnings || {}),
        // EDGAR is authoritative where it has the company; the IR page only
        // fills the gaps it leaves, never overwrites a filed figure
        ...(results ? {} : ir ? { period: ir.period, url: ir.url, source: ir.source } : {}),
        buyback: results?.buybackAmount ? undefined : ir?.buyback || undefined,
      };
    }

    if (transcripts.length) financialData.transcripts = transcripts;
    if (fullText.length) financialData.fullTextFilings = fullText;
    if (ir) financialData.investorRelations = ir;

    // Yahoo first, Finnhub second: Finnhub carries the fundamentals that Yahoo's
    // chart endpoint does not, so it should win on overlapping keys.
    if (yahooData) financialData = { ...financialData, ...yahooData };
    if (finnhubData) {
      for (const [key, value] of Object.entries(finnhubData)) {
        if (value !== undefined && value !== null) financialData[key] = value;
      }
    }
    if (secFilings.length > 0) financialData.secFilings = secFilings;

    console.log(`✅ Financial data fetched (${Object.keys(financialData).length} fields)`);
    return financialData;
  }

  // Get company info with fundamentals
  async getCompanyFundamentals(ticker) {
    if (!process.env.FINNHUB_API_KEY || !ticker) return null;

    try {
      const response = await axios.get('https://finnhub.io/api/v1/stock/profile2', {
        params: { symbol: ticker, token: process.env.FINNHUB_API_KEY },
        timeout: 8000,
      });

      const p = response.data;
      if (!p?.ticker) return null;

      return {
        name: p.name,
        ticker: p.ticker,
        industry: p.finnhubIndustry,
        website: p.weburl,
        logo: p.logo,
        country: p.country,
        exchange: p.exchange,
        ipo: p.ipo,
        marketCap: p.marketCapitalization ? p.marketCapitalization * 1e6 : undefined,
        shareOutstanding: p.shareOutstanding,
      };
    } catch (error) {
      console.error('❌ Fundamentals fetch error:', error.message);
    }

    return null;
  }
}

module.exports = new FinancialDataFetcher();
