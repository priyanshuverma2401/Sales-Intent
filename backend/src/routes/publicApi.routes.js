const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');

const Company = require('../models/Company');
const Report = require('../models/Report');
const Signal = require('../models/Signal');
const User = require('../models/User');
const reportGenerator = require('../services/reportGenerator');
const { authenticateApiKey } = require('../middleware/apiKey');

const router = express.Router();

// ---------------------------------------------------------------------------
// Public read API, v1. Authenticated by API key, scoped to one tenant.
//
// Every route answers the same question in a different shape: "what do we know
// about this account?" Errors carry a `code` as well as a message so a caller
// can branch on the reason rather than parse English.
// ---------------------------------------------------------------------------

router.use(authenticateApiKey);

const MAX_SIGNALS = 200;

// Every company any seat in this tenant has added. Accounts live on the user
// watchlist, so the tenant's account list is the union across its users.
async function organizationAccounts(organizationId) {
  const users = await User.find({ organizationId }).select('watchlist').lean();

  const ids = new Map();
  users.forEach(user => {
    (user.watchlist || []).forEach(entry => {
      if (entry.companyId) ids.set(String(entry.companyId), entry.companyId);
    });
  });

  if (ids.size === 0) return [];

  return Company.find({ _id: { $in: [...ids.values()] } }).lean();
}

// Exact name, then ticker, then a contains match - so "hsbc" and
// "HSBC Holdings plc" both resolve, but an exact name always wins.
function matchCompany(companies, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;

  return (
    companies.find(c => String(c.name || '').toLowerCase() === needle) ||
    companies.find(c => String(c.ticker || '').toLowerCase() === needle) ||
    companies.find(c => String(c.name || '').toLowerCase().includes(needle)) ||
    null
  );
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toCompanyPayload(company) {
  return {
    id: String(company._id),
    name: company.name,
    ticker: company.ticker || null,
    industry: company.industry || null,
    sector: company.sector || null,
    website: company.website || null,
    country: company.country || null,
    employees: company.employees ?? null,
    description: company.description || null,
    financials: company.financials || null,
  };
}

function toSignalPayload(signal) {
  return {
    id: String(signal._id),
    type: signal.type,
    category: signal.category || null,
    title: signal.title,
    description: signal.description || null,
    content: signal.content || null,
    source: signal.source || null,
    sourceUrl: signal.sourceUrl || null,
    priority: signal.priority,
    confidence: signal.confidence ?? null,
    tags: signal.tags || [],
    aiAnalysis: signal.aiAnalysis || null,
    publishedAt: signal.publishedAt || null,
    detectedAt: signal.detectedAt || null,
    createdAt: signal.createdAt,
  };
}

// The whole report, in the same shape the PDF is rendered from
function toReportPayload(report) {
  return {
    id: String(report._id),
    companyName: report.companyName,
    ticker: report.ticker || null,
    status: report.status,
    generatedAt: report.generatedAt,
    lastUpdatedAt: report.lastUpdatedAt || null,
    aiModel: report.aiModel || null,
    context: report.context || null,
    score: report.score || null,
    fastFacts: report.fastFacts || null,
    quickLinks: report.quickLinks || [],
    executiveBrief: report.executiveBrief || null,
    research: report.research || null,
    value: report.value || null,
    sources: report.sources || [],
  };
}

// The stored PDF as base64. Re-renders from the saved analysis if the file has
// gone missing - that reuses the stored text, so no AI calls are repeated.
async function readPdf(report) {
  if (report.pdfPath && fs.existsSync(report.pdfPath)) {
    const buffer = await fsp.readFile(report.pdfPath);
    return { fileName: report.pdfFileName || `salesmotion-${report.companyName}.pdf`, buffer };
  }

  const rendered = await reportGenerator.generate(report, {});
  report.pdfPath = rendered.filePath;
  report.pdfFileName = rendered.fileName;
  await report.save();

  return { fileName: rendered.fileName, buffer: await fsp.readFile(rendered.filePath) };
}

// ---------------------------------------------------------------------------
// GET /api/v1/ping - check a key works
// ---------------------------------------------------------------------------
router.get('/ping', (req, res) => {
  res.json({
    ok: true,
    organization: req.organization.name,
    key: req.apiKey.name,
    now: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/accounts - every account this tenant has added
// ---------------------------------------------------------------------------
router.get('/accounts', async (req, res) => {
  try {
    const accounts = await organizationAccounts(req.organization._id);
    res.json({
      count: accounts.length,
      accounts: accounts.map(toCompanyPayload),
    });
  } catch (error) {
    res.status(500).json({ error: error.message, code: 'SERVER_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/reports?company=HSBC
//
//   &includePdf=false   skip the base64 PDF (much smaller response)
//   &signals=50         cap the signal list (default 100, max 200)
//   &days=30            only signals from the last N days
// ---------------------------------------------------------------------------
router.get('/reports', async (req, res) => {
  try {
    const requested = String(req.query.company || req.query.name || '').trim();

    if (!requested) {
      return res.status(400).json({
        error: 'Pass the company name as ?company=',
        code: 'COMPANY_REQUIRED',
      });
    }

    // 1. Is it one of this tenant's accounts?
    const accounts = await organizationAccounts(req.organization._id);
    const company = matchCompany(accounts, requested);

    if (!company) {
      // Distinguish "we have never heard of it" from "you have not added it",
      // because the caller's next step is different in each case.
      const known = await Company.findOne({
        $or: [
          { name: new RegExp(`^${escapeRegex(requested)}$`, 'i') },
          { ticker: new RegExp(`^${escapeRegex(requested)}$`, 'i') },
          { name: new RegExp(escapeRegex(requested), 'i') },
        ],
      }).lean();

      if (known) {
        return res.status(404).json({
          error: `${known.name} is not one of your accounts. Add it in SalesMotion first.`,
          code: 'ACCOUNT_NOT_ADDED',
          company: { name: known.name, ticker: known.ticker || null },
        });
      }

      return res.status(404).json({
        error: `No company matching “${requested}” has been added to SalesMotion.`,
        code: 'COMPANY_NOT_FOUND',
        requested,
      });
    }

    // 2. Has a report been generated for it? Reports predating organizationId
    // are matched through their author instead.
    const orgUserIds = await User.find({ organizationId: req.organization._id }).distinct('_id');
    const scope = {
      companyId: company._id,
      $or: [{ organizationId: req.organization._id }, { userId: { $in: orgUserIds } }],
    };

    const report = await Report.findOne({ ...scope, status: 'complete' }).sort({ generatedAt: -1 });

    if (!report) {
      const inFlight = await Report.findOne({ ...scope, status: { $in: ['pending', 'failed'] } })
        .sort({ generatedAt: -1 });

      if (inFlight?.status === 'pending') {
        return res.status(409).json({
          error: `A report for ${company.name} is still generating.`,
          code: 'REPORT_PENDING',
          progress: inFlight.progress || null,
          company: toCompanyPayload(company),
        });
      }
      if (inFlight?.status === 'failed') {
        return res.status(409).json({
          error: inFlight.error || `The last report for ${company.name} failed to generate.`,
          code: 'REPORT_FAILED',
          company: toCompanyPayload(company),
        });
      }

      return res.status(404).json({
        error: `${company.name} is one of your accounts, but no report has been generated for it yet.`,
        code: 'REPORT_NOT_FOUND',
        company: toCompanyPayload(company),
      });
    }

    // 3. Signals for the account
    const limit = Math.min(Number(req.query.signals) || 100, MAX_SIGNALS);
    const signalFilter = { companyId: company._id };
    const days = Number(req.query.days);
    if (days > 0) {
      const since = new Date();
      since.setDate(since.getDate() - days);
      signalFilter.createdAt = { $gte: since };
    }

    const signals = await Signal.find(signalFilter).sort({ createdAt: -1 }).limit(limit);

    // 4. The PDF itself, unless the caller opted out
    let pdf = null;
    if (String(req.query.includePdf || 'true') !== 'false') {
      try {
        const file = await readPdf(report);
        pdf = {
          fileName: file.fileName,
          mimeType: 'application/pdf',
          encoding: 'base64',
          byteSize: file.buffer.length,
          content: file.buffer.toString('base64'),
        };
      } catch (error) {
        // A missing PDF must not sink the whole response - the report text,
        // which is what the PDF is rendered from, is already in hand.
        console.error('API PDF read error:', error.message);
        pdf = { error: 'The PDF could not be read for this report', code: 'PDF_UNAVAILABLE' };
      }
    }

    res.json({
      requested,
      company: toCompanyPayload(company),
      report: toReportPayload(report),
      pdf,
      signals: signals.map(toSignalPayload),
      meta: {
        signalCount: signals.length,
        signalLimit: limit,
        days: days > 0 ? days : null,
        retrievedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Public API error:', error);
    res.status(500).json({ error: error.message, code: 'SERVER_ERROR' });
  }
});

module.exports = router;
