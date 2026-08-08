const express = require('express');
const Company = require('../models/Company');
const User = require('../models/User');
const { authenticate } = require('../middleware/auth');
const companyDataFetcher = require('../services/dataFetchers/companyDataFetcher');
const financialDataFetcher = require('../services/dataFetchers/financialDataFetcher');
const accountTagging = require('../services/accountTagging');
const logoDevFetcher = require('../services/dataFetchers/logoDevFetcher');
const brandfetchFetcher = require('../services/dataFetchers/brandfetchFetcher');
const signalService = require('../services/signalService');
const reportService = require('../services/reportService');

const router = express.Router();

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

// News classification now lives in signalService, alongside the extraction and
// filing it feeds - see signalService.classifySignal.

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
      // An account already on the list is shown whatever we know about it -
      // dropping the rep's own saved company for want of a homepage would be
      // worse than showing it without one
      ...dbResults.map(c => {
        const domain = companyDataFetcher.hostname(c.website);

        return {
          _id: c._id,
          name: c.name,
          ticker: c.ticker,
          industry: c.industry,
          // Shown as a domain so a saved account reads the same as a suggestion
          website: domain,
          logoUrl:
            logoDevFetcher.imageUrl(domain) ||
            brandfetchFetcher.logoUrl(domain) ||
            c.logoUrl ||
            companyDataFetcher.faviconUrl(domain),
          logoFallbackUrl: c.logoUrl,
          wikidataId: c.wikidataId,
          source: 'local',
        };
      }),
      ...wikiResults.map(w => ({
        name: w.name,
        source: w.source,
        website: w.website,
        logoUrl: w.logoUrl,
        logoFallbackUrl: w.logoFallbackUrl,
        ticker: w.ticker,
        // Carried back on "add" so the account is enriched from the entity and
        // homepage the rep actually picked, not from a fresh search for its name
        wikidataId: w.wikidataId,
      })),
    ];

    // Deduped on the homepage, and on the name only for a record that has no
    // homepage to be told apart by.
    //
    // Keying on the name alone is what made a search for "noon" return three
    // rows where the brand index had five: noon.com, noon.ai and noonclo.com
    // are three unrelated companies that happen to share a name, and folding
    // them together dropped noon.com - the one the rep was looking for.
    //
    // First occurrence wins, which is why local hits are listed first: a saved
    // account carries an _id and a note, and the same company found online does
    // not. `new Map(entries)` keeps the *last* value for a repeated key, so the
    // insert is guarded rather than done in bulk.
    const seen = new Map();
    for (const result of allResults) {
      const key = result.website || `name:${String(result.name || '').toLowerCase()}`;
      if (!seen.has(key)) seen.set(key, result);
    }

    const uniqueResults = Array.from(seen.values());

    res.json(uniqueResults);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add a prospect account. What the report focuses on comes from the tenant's
// company profile, so the only inputs here are the company itself and an
// optional personal note. Report generation kicks off immediately unless the
// caller opts out.
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, ticker, notes, wikidataId, website, generateReport = true } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Company name required' });
    }

    let company = await Company.findOne({ name });

    if (!company) {
      console.log(`📊 Fetching data for new company: ${name}`);

      // The suggestion the rep picked names the exact entity and homepage, so
      // enrichment skips the name search that used to decide between the four
      // companies called HDFC on its own
      const companyInfo = await companyDataFetcher.fetchCompanyInfo(name, ticker, {
        wikidataId,
        domain: website,
      });
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
        profiles: companyInfo.profiles,
        wikidataId: companyInfo.wikidataId || wikidataId,
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
        // Guessed from the industry so the vertical trade press, regulator,
        // patent and contract crawls work from the first report. Whoever knows
        // better corrects it in Account settings, and that answer then sticks.
        tags: accountTagging.derive({
          industry: companyInfo.industry,
          description: companyInfo.description,
        }),
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

    const existing = req.user.watchlist.find(
      w => w.companyId?.toString() === company._id.toString()
    );

    if (existing) {
      // Re-adding is treated as an update of the note rather than an error
      if (notes !== undefined) existing.notes = notes;
    } else {
      req.user.watchlist.push({
        companyId: company._id,
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

    // Bias the refresh toward the topics the tenant monitors, high priority
    // first, so the signals that appear are the ones worth acting on
    const seller = req.organization?.toSellerContext?.() || {};
    const keywords = [
      ...(seller.priorityTopics || []),
      ...(seller.standardTopics || []),
    ].filter(Boolean);

    // The crawl, the extraction and the filing all live in signalService, so
    // pressing Refresh produces exactly what the nightly sweep would have
    // produced on its own - the button is a way to not wait, not a second
    // implementation that can drift from the first.
    const result = await signalService.refreshCompany(company, keywords);
    const { financial, jobs } = result;

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

    res.json({
      message: 'Data refreshed successfully',
      newsFound: result.newsFound,
      signalsCreated: result.created,
      jobsFound: result.jobsFound,
      patentsFound: result.patentsFound,
      awardsFound: result.awardsFound,
    });
  } catch (error) {
    console.error('Refresh error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
