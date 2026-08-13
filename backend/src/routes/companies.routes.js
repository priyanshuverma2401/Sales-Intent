const fs = require('fs');
const express = require('express');
const Company = require('../models/Company');
const User = require('../models/User');
const Report = require('../models/Report');
const Signal = require('../models/Signal');
const Alert = require('../models/Alert');
const { authenticate, isManager } = require('../middleware/auth');
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

// ---------------------------------------------------------------------------
// Identifying a company that is already on the books
//
// One prospect must never end up as two accounts. Exact-name matching was not
// enough for that: "LTIMindtree", "LTIMindtree Limited" and "LTM Limited" are
// the same company typed three ways, and each produced its own row, its own
// reports and its own signal history.
// ---------------------------------------------------------------------------

// Dropped when comparing names. None of these distinguishes one company from
// another - they are how a company is incorporated, not who it is.
const LEGAL_SUFFIXES =
  /\b(limited|ltd|llc|inc|incorporated|corp|corporation|plc|sa|nv|ag|gmbh|pvt|private|co|company|holdings|group)\b/g;

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[.,&'’]/g, ' ')
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hostOf(url) {
  return String(url || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0];
}

/**
 * The company this request is about, if the workspace already holds it.
 *
 * Tried in order of how certain each identifier is: the Wikidata entity names
 * exactly one company in the world, a homepage names one business, and a name
 * is only a guess until it is stripped of its legal suffix.
 */
async function findExistingCompany({ name, wikidataId, website }) {
  if (wikidataId) {
    const byEntity = await Company.findOne({ wikidataId });
    if (byEntity) return byEntity;
  }

  const typed = String(name || '').trim();
  if (typed) {
    const byName = await Company.findOne({ name: new RegExp(`^${escapeRegex(typed)}$`, 'i') });
    if (byName) return byName;
  }

  const host = hostOf(website);
  if (host) {
    const bySite = await Company.findOne({
      website: new RegExp(`^https?://(www\\.)?${escapeRegex(host)}(/|$|\\?)`, 'i'),
    });
    if (bySite) return bySite;
  }

  // Same company, different legal suffix. Narrowed to names starting with the
  // same first word so this stays a prefix scan rather than a full sweep, and
  // the actual decision is made on the normalised forms.
  const bare = normalizeName(typed);
  const [firstWord] = bare.split(' ');
  if (!firstWord || firstWord.length < 3) return null;

  const candidates = await Company.find({ name: new RegExp(`^${escapeRegex(firstWord)}`, 'i') })
    .limit(25);

  return candidates.find(c => normalizeName(c.name) === bare) || null;
}

/**
 * Pull fresh news, signals, firmographics and market data onto a company.
 *
 * Shared by the Refresh button and by re-adding an account that is already
 * tracked, so both produce exactly what the nightly sweep would have - one
 * behaviour, not two implementations that can drift apart.
 */
async function refreshCompanyData(company, organization) {
  console.log(`🔄 Refreshing data for ${company.name}`);

  // Bias the refresh toward the topics the tenant monitors, high priority
  // first, so the signals that appear are the ones worth acting on
  const seller = organization?.toSellerContext?.() || {};
  const keywords = [
    ...(seller.priorityTopics || []),
    ...(seller.standardTopics || []),
  ].filter(Boolean);

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

  return {
    newsFound: result.newsFound,
    signalsCreated: result.created,
    jobsFound: result.jobsFound,
    patentsFound: result.patentsFound,
    awardsFound: result.awardsFound,
  };
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

    // One prospect, one account. Somebody adding a company a teammate already
    // added is asking for a fresh look at it, not for a second copy of it.
    let company = await findExistingCompany({ name, wikidataId, website });
    const alreadyTracked = Boolean(company);

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
        employeesAsOf: companyInfo.employeesAsOf,
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
    } else {
      // Re-adding is a request to look again. The crawl runs in the background
      // rather than being awaited: it can take the best part of a minute, and
      // holding the request open that long would read as a hung "Add" button.
      //
      // Nothing is written from stale data as a result - the report pipeline
      // fetches its own news and filings regardless. What this catches up is
      // the signals feed and the firmographics on the account itself.
      const organization = req.organization;
      setImmediate(() => {
        refreshCompanyData(company, organization).catch(error =>
          console.warn(`⚠️ Refresh on re-add failed for ${company.name}: ${error.message}`)
        );
      });
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

    // Who first put this account on the books, so the client can say "already
    // tracked by Ravi" rather than the unhelpful "that already exists".
    const addedBy = alreadyTracked && company.addedBy
      ? await User.findById(company.addedBy).select('firstName lastName email').lean()
      : null;

    res.status(alreadyTracked ? 200 : 201).json({
      company,
      reportId: report?._id || null,
      reportStatus: report ? 'pending' : null,
      reportError,
      // The client needs to tell the two apart: adding a new account and
      // refreshing one the team already has read very differently to a user.
      alreadyTracked,
      addedByName: addedBy
        ? `${addedBy.firstName || ''} ${addedBy.lastName || ''}`.trim() || addedBy.email
        : null,
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

/**
 * Remove an account from the whole workspace.
 *
 * Since one prospect is now one shared account rather than a copy per seat,
 * removing it has to mean removing it for everyone - a delete that left the
 * account on four other people's boards would not be a delete.
 *
 * Only the person who added it, or an owner/admin, may do that. Accounts added
 * before `addedBy` was recorded belong to nobody, so anyone on the team may
 * clear them rather than their being stuck on the board forever.
 *
 * The Company document itself survives: it is shared with every other tenant
 * watching the same prospect, and none of them asked for it to go.
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    const unattributed = !company.addedBy;
    const mine = company.addedBy?.toString() === req.user._id.toString();

    if (!mine && !unattributed && !isManager(req.user)) {
      const adder = await User.findById(company.addedBy).select('firstName lastName email').lean();
      const who = adder
        ? `${adder.firstName || ''} ${adder.lastName || ''}`.trim() || adder.email
        : 'whoever added it';

      return res.status(403).json({
        error: `${company.name} was added by ${who}. Only they, or an owner, can remove it for the team.`,
      });
    }

    const orgId = req.organization?._id;
    const memberIds = orgId
      ? await User.distinct('_id', { organizationId: orgId })
      : [req.user._id];

    await User.updateMany(
      { _id: { $in: memberIds } },
      { $pull: { watchlist: { companyId: company._id } } }
    );

    // Each report owns a rendered PDF on disk, so the files go before the
    // records that point at them - otherwise the directory grows forever.
    const reports = await Report.find({
      companyId: company._id,
      $or: [{ organizationId: orgId }, { userId: { $in: memberIds } }],
    }).select('pdfPath');

    reports.forEach((report) => {
      if (report.pdfPath && fs.existsSync(report.pdfPath)) fs.unlink(report.pdfPath, () => {});
    });
    await Report.deleteMany({ _id: { $in: reports.map(r => r._id) } });

    // Only this tenant's own signals. Signals derived from public sources are
    // shared with every other tenant watching the same company.
    if (orgId) await Signal.deleteMany({ companyId: company._id, organizationId: orgId });

    // An alert rule on an account nobody is watching would keep firing
    await Alert.deleteMany({ companyId: company._id, userId: { $in: memberIds } });

    res.json({
      message: `${company.name} removed for the team`,
      companyName: company.name,
      reportsDeleted: reports.length,
    });
  } catch (error) {
    console.error('Remove account error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Refresh company data. The work itself lives in refreshCompanyData, shared
// with the re-add path so both produce the same result.
router.post('/:id/refresh', authenticate, async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const result = await refreshCompanyData(company, req.organization);

    res.json({
      message: 'Data refreshed successfully',
      companyName: company.name,
      ...result,
    });
  } catch (error) {
    console.error('Refresh error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
