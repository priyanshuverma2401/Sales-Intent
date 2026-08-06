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

  // Main financial data fetch
  async fetchFinancialData(ticker) {
    if (!ticker) return {};

    console.log(`💰 Fetching financial data for ${ticker}`);

    let financialData = {};

    const [finnhubData, yahooData, secFilings] = await Promise.all([
      this.fetchFromFinnhub(ticker),
      this.fetchFromYahooFinance(ticker),
      this.fetchSecFilings(ticker),
    ]);

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
