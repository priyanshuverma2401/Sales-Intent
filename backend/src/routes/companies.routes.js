const express = require('express');
const Company = require('../models/Company');
const Signal = require('../models/Signal');
const User = require('../models/User');
const { authenticate } = require('../middleware/auth');
const newsDataFetcher = require('../services/dataFetchers/newsDataFetcher');
const financialDataFetcher = require('../services/dataFetchers/financialDataFetcher');
const companyDataFetcher = require('../services/dataFetchers/companyDataFetcher');
const jobDataFetcher = require('../services/dataFetchers/jobDataFetcher');
const aiEngine = require('../services/aiEngine');
const reportService = require('../services/reportService');

const router = express.Router();

function toStringArray(value) {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map(v => v.trim()).filter(Boolean);
  return [];
}

// Which fetched fields belong on company.stock vs company.financials
const STOCK_FIELDS = [
  'currentPrice', 'dayHigh', 'dayLow', 'openPrice', 'previousClose',
  'fiftyTwoWeekHigh', 'fiftyTwoWeekLow', 'volume', 'marketCap', 'currency', 'exchange',
];
const FINANCIAL_FIELDS = [
  'marketCap', 'revenue', 'revenueGrowth', 'earnings', 'eps',
  'peRatio', 'debtToEquity', 'currentRatio', 'roe', 'secFilings',
];

// Split a flat fetcher payload into the two sub-documents the schema defines.
// Previously everything was merged into `financials`, so price fields were
// dropped by Mongoose and `stock` was never populated at all.
function splitFinancialPayload(data = {}) {
  const stock = {};
  const financials = {};

  for (const key of STOCK_FIELDS) {
    if (data[key] !== undefined && data[key] !== null) stock[key] = data[key];
  }
  for (const key of FINANCIAL_FIELDS) {
    if (data[key] !== undefined && data[key] !== null) financials[key] = data[key];
  }

  return { stock, financials };
}

// Escape user input before embedding it in a RegExp
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Classify a news item so signals are not all filed as generic 'news'
function classifySignal(article) {
  const text = `${article.title || ''} ${article.description || ''}`.toLowerCase();

  const rules = [
    { type: 'earnings', priority: 'high', words: ['earnings', 'quarterly results', 'revenue beat', 'q1 ', 'q2 ', 'q3 ', 'q4 ', 'fiscal year'] },
    { type: 'ma', priority: 'high', words: ['acquire', 'acquisition', 'merger', 'buyout', 'takeover'] },
    { type: 'funding', priority: 'high', words: ['funding', 'raises', 'series a', 'series b', 'series c', 'investment round', 'valuation'] },
    { type: 'executive', priority: 'high', words: ['ceo', 'cfo', 'cto', 'appointed', 'steps down', 'resigns', 'named president'] },
    { type: 'hiring', priority: 'medium', words: ['hiring', 'layoff', 'job cuts', 'headcount', 'expands team', 'recruit'] },
    { type: 'partnership', priority: 'medium', words: ['partnership', 'partners with', 'collaboration', 'teams up', 'alliance'] },
    { type: 'regulation', priority: 'high', words: ['lawsuit', 'regulator', 'antitrust', 'investigation', 'fine', 'compliance'] },
    { type: 'product', priority: 'medium', words: ['launch', 'unveils', 'releases', 'introduces', 'new product'] },
  ];

  for (const rule of rules) {
    if (rule.words.some(word => text.includes(word))) {
      return { type: rule.type, priority: rule.priority };
    }
  }

  return { type: 'news', priority: 'medium' };
}

// Search companies
router.get('/search', authenticate, async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Search query too short' });
    }

    const safe = escapeRegex(q);

    const dbResults = await Company.find({
      $or: [
        { name: { $regex: safe, $options: 'i' } },
        { ticker: { $regex: safe, $options: 'i' } },
      ],
    }).limit(5);

    const wikiResults = await companyDataFetcher.searchCompanies(q);

    const allResults = [
      ...dbResults.map(c => ({
        _id: c._id,
        name: c.name,
        ticker: c.ticker,
        industry: c.industry,
        // Shown as a domain so a saved account reads the same as a suggestion
        website: companyDataFetcher.hostname(c.website),
        source: 'local',
      })),
      ...wikiResults.map(w => ({
        name: w.name,
        source: w.source,
        snippet: w.snippet,
        website: w.website,
      })),
    ];

    // Local hits are inserted first, so keeping the first occurrence of each
    // name preserves the richer record
    const uniqueResults = Array.from(
      new Map(allResults.map(r => [r.name, r])).values()
    );

    res.json(uniqueResults);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add a prospect account. `keywords` sets the pitch lens for this account only;
// leaving it empty inherits the rep's profile keywords. Report generation kicks
// off immediately unless the caller opts out.
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, ticker, keywords, notes, generateReport = true } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Company name required' });
    }

    let company = await Company.findOne({ name });

    if (!company) {
      console.log(`📊 Fetching data for new company: ${name}`);

      const companyInfo = await companyDataFetcher.fetchCompanyInfo(name, ticker);
      const financialData = ticker ? await financialDataFetcher.fetchFinancialData(ticker) : {};
      const { stock, financials } = splitFinancialPayload(financialData);

      company = new Company({
        name,
        ticker: ticker || companyInfo.ticker,
        industry: companyInfo.industry,
        description: companyInfo.description,
        website: companyInfo.website,
        employees: companyInfo.employees,
        foundedYear: companyInfo.foundedYear,
        logoUrl: companyInfo.logo,
        city: companyInfo.city,
        country: companyInfo.country || 'Unknown',
        financials: {
          // Revenue comes from the firmographics lookup, not the market feeds,
          // so it is merged in rather than read out of splitFinancialPayload
          revenue: companyInfo.revenue,
          revenueCurrency: companyInfo.revenueCurrency,
          revenueAsOf: companyInfo.revenueAsOf,
          ...financials,
          lastUpdated: new Date(),
        },
        stock: { ...stock, lastUpdated: new Date() },
        addedBy: req.user._id,
        dataSources: {
          wikipedia: { lastFetched: new Date(), status: 'success' },
          wikidata: { lastFetched: new Date(), status: companyInfo.city ? 'success' : 'empty' },
          finnhub: { lastFetched: new Date(), status: ticker ? 'success' : 'skipped' },
        },
      });

      await company.save();
      console.log(`✅ Company saved: ${name}`);
    }

    // Add to the user's account list, avoiding duplicates
    if (!req.user.watchlist) req.user.watchlist = [];

    const accountKeywords = toStringArray(keywords);
    const existing = req.user.watchlist.find(
      w => w.companyId?.toString() === company._id.toString()
    );

    if (existing) {
      // Re-adding is treated as an update of the lens rather than an error
      if (accountKeywords.length) existing.keywords = accountKeywords;
      if (notes !== undefined) existing.notes = notes;
    } else {
      req.user.watchlist.push({
        companyId: company._id,
        keywords: accountKeywords,
        notes,
        addedAt: new Date(),
      });
    }
    await req.user.save();

    // The point of adding an account is the report, so start it here rather
    // than making the user press a second button.
    let report = null;
    let reportError = null;

    if (generateReport) {
      try {
        report = await reportService.start({
          user: req.user,
          organization: req.organization,
          company,
        });
      } catch (error) {
        // The account is still saved; surface why the report did not start
        reportError = { error: error.message, code: error.code };
        console.warn(`⚠️ Report not started for ${company.name}: ${error.message}`);
      }
    }

    res.status(201).json({
      company,
      keywords: accountKeywords.length ? accountKeywords : (req.user.profile?.keywords || []),
      reportId: report?._id || null,
      reportStatus: report ? 'pending' : null,
      reportError,
    });
  } catch (error) {
    console.error('Add company error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get user's watchlist.
// Declared before '/:id' so the bare path is not swallowed by the id route.
router.get('/', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('watchlist.companyId');
    // populate leaves null where a referenced company was deleted
    const companies = (user.watchlist || []).map(w => w.companyId).filter(Boolean);
    res.json(companies);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get company details
router.get('/:id', authenticate, async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    res.json(company);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Remove company from watchlist
router.delete('/:id', authenticate, async (req, res) => {
  try {
    req.user.watchlist = (req.user.watchlist || []).filter(
      w => w.companyId?.toString() !== req.params.id
    );
    await req.user.save();

    res.json({ message: 'Company removed from watchlist' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Refresh company data
router.post('/:id/refresh', authenticate, async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    console.log(`🔄 Refreshing data for ${company.name}`);

    // Bias the refresh toward whatever this rep pitches into the account, so
    // the signals that appear are the ones they can act on
    const entry = (req.user.watchlist || []).find(
      w => w.companyId?.toString() === company._id.toString()
    );
    const keywords = entry?.keywords?.length ? entry.keywords : (req.user.profile?.keywords || []);

    const [news, financial, jobs] = await Promise.all([
      newsDataFetcher.fetchNews(company.name, company.ticker, keywords),
      company.ticker ? financialDataFetcher.fetchFinancialData(company.ticker) : Promise.resolve({}),
      jobDataFetcher.fetchJobData(company.name),
    ]);

    const { stock, financials } = splitFinancialPayload(financial);

    company.financials = { ...company.financials?.toObject?.() ?? company.financials, ...financials, lastUpdated: new Date() };
    company.stock = { ...company.stock?.toObject?.() ?? company.stock, ...stock, lastUpdated: new Date() };

    // Headcount, headquarters and revenue, for accounts stored before those
    // were ever fetched. Saves the document itself when it fills anything in.
    // force: pressing Refresh is an explicit request to look again, so it skips
    // the cooldown that keeps report generation from re-querying a known miss
    await companyDataFetcher.backfill(company, { force: true }).catch(e =>
      console.warn(`⚠️ Firmographics backfill skipped: ${e.message}`)
    );

    // Backfill descriptive fields that were missing. Enrichment only ran when a
    // company was first added, so anything absent then stayed blank forever.
    if (!company.industry && financial.industry) company.industry = financial.industry;
    if (!company.website && financial.website) company.website = financial.website;
    // Finnhub states a logo, so it also replaces an article lead image left
    // behind when Wikidata had no logo of its own to offer
    if (financial.logo && (!company.logoUrl || companyDataFetcher.isArticleImage(company.logoUrl))) {
      company.logoUrl = financial.logo;
    }
    if ((!company.country || company.country === 'Unknown') && financial.country) {
      company.country = financial.country;
    }

    if (!company.dataSources) company.dataSources = {};
    company.dataSources.news = { lastFetched: new Date(), status: 'success' };
    company.dataSources.jobs = {
      lastFetched: new Date(),
      status: jobs.openPositions?.length ? 'success' : 'empty',
    };
    company.updatedAt = new Date();
    await company.save();

    // Turn the freshest news into signals, skipping ones already stored
    let created = 0;
    for (const item of news.slice(0, 5)) {
      if (!item.title) continue;

      const existingSignal = await Signal.findOne({
        companyId: company._id,
        title: item.title,
      });
      if (existingSignal) continue;

      const { type, priority } = classifySignal(item);

      const signal = new Signal({
        companyId: company._id,
        companyName: company.name,
        ticker: company.ticker,
        type,
        priority,
        title: item.title,
        description: item.description,
        source: item.source?.name,
        sourceUrl: item.url,
        publishedAt: item.publishedAt,
      });

      const analysis = await aiEngine.analyzeSignal(item, { company: company.name, keywords });
      signal.aiAnalysis = { summary: analysis, generatedAt: new Date() };

      await signal.save();
      created += 1;
    }

    // Hiring/executive moves detected in the same news batch
    const appointments = jobDataFetcher.parseExecutiveAppointments(news);
    for (const appointment of appointments.slice(0, 3)) {
      const existing = await Signal.findOne({ companyId: company._id, title: appointment.title });
      if (existing) continue;

      await new Signal({
        companyId: company._id,
        companyName: company.name,
        ticker: company.ticker,
        type: 'executive',
        priority: 'high',
        title: appointment.title,
        description: appointment.description,
        source: appointment.source?.name || appointment.source,
        sourceUrl: appointment.url,
        publishedAt: appointment.date,
      }).save();
      created += 1;
    }

    res.json({
      message: 'Data refreshed successfully',
      newsFound: news.length,
      signalsCreated: created,
      jobsFound: jobs.openPositions?.length || 0,
    });
  } catch (error) {
    console.error('Refresh error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
