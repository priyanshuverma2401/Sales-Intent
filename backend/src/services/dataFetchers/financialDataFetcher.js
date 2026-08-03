const axios = require('axios');

// SEC requires a descriptive User-Agent with contact details on every request
const SEC_HEADERS = {
  'User-Agent': process.env.SEC_USER_AGENT || 'SalesMotion/1.0 (support@salesmotion.local)',
  'Accept-Encoding': 'gzip, deflate',
};

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

      return filings;
    } catch (error) {
      console.error('❌ SEC EDGAR error:', error.message);
    }

    return [];
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
