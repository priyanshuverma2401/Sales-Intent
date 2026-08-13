const express = require('express');
const fs = require('fs');
const mongoose = require('mongoose');
const Report = require('../models/Report');
const Company = require('../models/Company');
const User = require('../models/User');
const { authenticate, isManager, sameOrg } = require('../middleware/auth');
const reportService = require('../services/reportService');
const reportGenerator = require('../services/reportGenerator');
const reportQA = require('../services/reportQA');
const accountRemoval = require('../services/accountRemoval');

const router = express.Router();

function isAuthor(report, req) {
  return report.userId?.toString() === req.user._id.toString();
}

// Everyone in the tenant reads everything the tenant produced - a member is
// meant to learn from a colleague's research, not be walled off from it.
function canRead(report, req) {
  return isAuthor(report, req) || sameOrg(report, req);
}

// Quick Links compared by what they point at, so a stored list is only
// rewritten when it genuinely differs
function sameLinks(a = [], b = []) {
  const flatten = links =>
    (links || []).map(link => `${link.label}|${link.url}`).join('\n');

  return flatten(a) === flatten(b);
}

/**
 * Who may delete a report.
 *
 * An owner or admin may remove anything they can read, no further questions:
 * they run the tenant, so nothing it produced should be beyond them. That is
 * checked against canRead rather than sameOrg so it also covers reports written
 * before organizationId was stored - those surface to nobody but their own
 * author, so this cannot reach into another tenant's work.
 *
 * For everyone else it is governed by the account rather than by who pressed
 * Generate: an account is one shared thing the whole team works, and the person
 * who put it on the board is the one answerable for what is filed against it.
 *
 * `accountAddedBy` is the company's `addedBy`. Accounts stored before that was
 * recorded belong to nobody, so on those the report's own author can still
 * clear their work rather than nobody being able to.
 */
function canDelete(report, req, accountAddedBy) {
  const me = req.user._id.toString();

  if (isManager(req.user) && canRead(report, req)) return true;
  if (accountAddedBy && accountAddedBy.toString() === me) return true;

  return !accountAddedBy && isAuthor(report, req);
}

// ---------------------------------------------------------------------------
// Generate a report for one prospect
//
// One report per account per tenant: if the team already has one, this rewrites
// it rather than filing a second copy alongside it. The response says which
// happened, because "we are writing your report" and "we are bringing the one
// you are looking at up to date" are different promises.
// ---------------------------------------------------------------------------
router.post('/:companyId', authenticate, async (req, res) => {
  try {
    const company = await Company.findById(req.params.companyId);
    if (!company) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const report = await reportService.start({
      user: req.user,
      organization: req.organization,
      company,
    });

    // Set when a run was already under way and this request joined it instead
    // of starting a second one
    const joined = Boolean(report.joinedExistingRun);
    const refreshing = report.refresh?.status === 'pending';

    res.status(202).json({
      message: refreshing
        ? 'Refreshing the existing report'
        : joined
          ? 'This report is already being written'
          : 'Report generation started',
      reportId: report._id,
      status: report.status,
      // The client keeps the finished report on screen while this is true
      refreshing,
      joinedExistingRun: joined,
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, code: error.code });
  }
});

// Everything the caller is entitled to see. Reports written before
// organizationId was stored have none, so the author's own work is unioned in
// rather than disappearing from their list.
function visibleScope(req) {
  return req.organization?._id
    ? { $or: [{ organizationId: req.organization._id }, { userId: req.user._id }] }
    : { userId: req.user._id };
}

// User input goes into a $regex, so metacharacters have to be defanged - a
// search for "C++ Ltd." must not compile into a pattern (or blow up).
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Options for the report filters: who has written reports, and for which
// prospect industries. Derived from the whole visible set, so the dropdowns stay
// complete no matter how narrow the current filter is.
//
// Industry is the prospect's own, not a seller-side lens: every report in a
// tenant now shares one lens (the company profile), so filtering on that would
// only ever return everything.
// Declared before '/:id' so "filters" is never read as an id.
// ---------------------------------------------------------------------------
router.get('/filters', authenticate, async (req, res) => {
  try {
    const scope = visibleScope(req);

    const [authorIds, industries] = await Promise.all([
      Report.distinct('userId', scope),
      Report.distinct('fastFacts.industry', scope),
    ]);

    const authors = await User.find({ _id: { $in: authorIds.filter(Boolean) } })
      .select('firstName lastName email')
      .sort({ firstName: 1, lastName: 1 });

    res.json({
      authors: authors.map(a => ({
        _id: a._id,
        name: `${a.firstName || ''} ${a.lastName || ''}`.trim() || a.email,
      })),
      industries: industries.filter(v => typeof v === 'string' && v.trim()).sort(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// List every report in the signed-in user's organization (summary payload only)
//
// Org-wide for both roles: a rep should see what the desk has already researched
// rather than regenerate it. Each row carries who wrote it and whether the
// caller may delete it, so the UI never has to infer permissions from the role.
//
// Filtering is done here rather than in the browser so it covers the whole
// history instead of only the page that happens to be loaded.
//   ?q=hsbc          company name, ticker or industry, case-insensitive
//   ?author=<userId> who generated it
//   ?industry=<name> the prospect's industry
// ---------------------------------------------------------------------------
router.get('/', authenticate, async (req, res) => {
  try {
    const scope = visibleScope(req);
    const { q, author, industry } = req.query;

    // $and keeps the scope's own $or intact when the search adds a second one
    const conditions = [scope];

    if (q && String(q).trim()) {
      const rx = new RegExp(escapeRegex(String(q).trim()), 'i');
      conditions.push({
        $or: [{ companyName: rx }, { ticker: rx }, { 'fastFacts.industry': rx }],
      });
    }
    if (author && author !== 'all' && mongoose.isValidObjectId(author)) {
      conditions.push({ userId: author });
    }
    if (industry && industry !== 'all') {
      conditions.push({ 'fastFacts.industry': String(industry) });
    }

    const filter = conditions.length > 1 ? { $and: conditions } : scope;

    // The unfiltered total, so the UI can say "8 of 60" without a second call.
    // Exposed via header to keep the body a plain array for existing callers.
    const total = await Report.countDocuments(scope);
    res.set('X-Total-Count', String(total));

    const reports = await Report.find(filter)
      .select([
        'companyName', 'companyId', 'ticker', 'status', 'progress', 'error',
        'score.value', 'score.band', 'score.summary',
        'context', 'generatedAt', 'aiModel', 'pdfFileName', 'userId',
        'fastFacts.industry', 'fastFacts.logoUrl', 'fastFacts.headquarters',
        // A rewrite in flight. The report stays 'complete' and readable while
        // it runs, so without this a card being refreshed looks idle.
        'refresh.status', 'refresh.step', 'refresh.percent',
      ].join(' '))
      .populate('userId', 'firstName lastName email')
      .sort({ generatedAt: -1 })
      .limit(120);

    // Delete rights follow the account, so the page needs to know who added
    // each one. Fetched in a single query rather than per row.
    const companyIds = [...new Set(reports.map(r => r.companyId?.toString()).filter(Boolean))];
    const companies = companyIds.length
      ? await Company.find({ _id: { $in: companyIds } }).select('addedBy').lean()
      : [];
    const adderByCompany = new Map(
      companies.map(c => [c._id.toString(), c.addedBy?.toString() || null])
    );

    const me = req.user._id.toString();

    res.json(reports.map(report => {
      const author = report.userId;
      const mine = author?._id?.toString() === me;
      const addedBy = adderByCompany.get(report.companyId?.toString()) || null;

      return {
        ...report.toObject(),
        // Flattened so the client never has to deal with a populated ref
        userId: author?._id,
        author: author
          ? {
              _id: author._id,
              name: `${author.firstName || ''} ${author.lastName || ''}`.trim() || author.email,
              email: author.email,
            }
          : null,
        isMine: mine,
        canDelete: canDelete(report, req, addedBy),
      };
    }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Full report
// ---------------------------------------------------------------------------
router.get('/:id', authenticate, async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    if (!canRead(report, req)) {
      return res.status(403).json({ error: 'Not authorized to view this report' });
    }

    // Looked up after the check rather than populated into it: canRead compares
    // report.userId as an id, and a populated document would not match.
    const [author, company] = await Promise.all([
      report.userId
        ? User.findById(report.userId).select('firstName lastName email')
        : null,
      report.companyId
        ? Company.findById(report.companyId).select('addedAt name website ticker profiles')
        : null,
    ]);

    // Rebuilt from the account rather than served as stored: Quick Links are a
    // pure function of the company, and a report written before its LinkedIn
    // and Crunchbase pages were known would otherwise keep pointing at a search
    // results page forever. Written back when it changes, so the public API and
    // any later render see the repaired links too.
    const quickLinks = company ? reportService.buildQuickLinks(company) : report.quickLinks;
    if (company && !sameLinks(quickLinks, report.quickLinks)) {
      Report.updateOne({ _id: report._id }, { $set: { quickLinks } }).catch(() => {});
    }

    res.json({
      ...report.toObject(),
      quickLinks,
      accountAddedAt: report.accountAddedAt || company?.addedAt || null,
      author: author
        ? {
            _id: author._id,
            name: `${author.firstName || ''} ${author.lastName || ''}`.trim() || author.email,
            email: author.email,
          }
        : null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Ask a question about one report
//
// Answered from the stored report and nothing else - see services/reportQA.js
// for why that constraint is the feature rather than a limitation. Read access
// is the same rule as viewing it: anyone in the tenant who can open the report
// can question it.
//
// The thread lives in the caller's browser, so it is replayed on each request
// rather than stored. Nothing a user asks about an account is persisted.
// ---------------------------------------------------------------------------
router.post('/:id/ask', authenticate, async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    if (!canRead(report, req)) {
      return res.status(403).json({ error: 'Not authorized to view this report' });
    }

    // A half-written report has no findings to question yet, and the reason it
    // has none is worth saying out loud.
    if (report.status !== 'complete') {
      return res.status(409).json({
        error:
          report.status === 'pending'
            ? 'This report is still being written — questions can be answered once it finishes.'
            : report.error || 'This report did not finish, so there is nothing to ask about yet.',
      });
    }

    const result = await reportQA.ask({
      report,
      question: req.body?.question,
      history: req.body?.history,
    });

    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// PDF download
// ---------------------------------------------------------------------------
router.get('/:id/download', authenticate, async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);

    if (!report) return res.status(404).json({ error: 'Report not found' });
    if (!canRead(report, req)) {
      return res.status(403).json({ error: 'Not authorized to download this report' });
    }
    if (report.status === 'pending') {
      return res.status(409).json({ error: 'Report is still generating' });
    }
    if (report.status === 'failed') {
      return res.status(409).json({ error: report.error || 'Report generation failed' });
    }

    const fileName = report.pdfFileName || `salesmotion-${report.companyName}.pdf`;

    // Serve the stored PDF; only re-render when the file is genuinely missing.
    // Re-rendering reuses the saved analysis, so no AI calls are repeated.
    if (report.pdfPath && fs.existsSync(report.pdfPath)) {
      return res.download(report.pdfPath, fileName);
    }

    console.log(`⚠️ Stored PDF missing for ${report.companyName} — re-rendering from saved analysis`);
    const rendered = await reportGenerator.generate(report, {});
    report.pdfPath = rendered.filePath;
    report.pdfFileName = rendered.fileName;
    await report.save();

    res.download(rendered.filePath, rendered.fileName);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Delete
//
// The account goes with it. There is one report per account per tenant, so a
// report delete that left the account behind would leave an empty row on the
// board that only invites somebody to press Generate again - which is how the
// duplicates got there in the first place. Deleting the report and removing the
// account are the same act, and the response says so rather than letting the
// account quietly vanish.
// ---------------------------------------------------------------------------
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });

    const company = report.companyId ? await Company.findById(report.companyId) : null;

    // Distinguish "not yours" from "does not exist": a member can see this
    // report in the list, so a 404 here would read as a bug rather than a rule.
    if (!canDelete(report, req, company?.addedBy)) {
      return res.status(403).json({
        error: canRead(report, req)
          ? 'Only the person who added this account, or an owner, can delete its reports'
          : 'Not authorized to delete this report',
      });
    }

    // Clears the watchlists, the tenant's signals and alerts, and every report
    // filed against the account - this one among them, PDF included.
    if (company) {
      const { reportsDeleted } = await accountRemoval.removeForTenant(company, req);

      return res.json({
        message: `${company.name} removed for the team`,
        accountRemoved: true,
        companyId: company._id,
        companyName: company.name,
        reportsDeleted,
      });
    }

    // A report with no account left to remove - orphaned by an earlier delete.
    // Nothing to tear down, so just take the record and its PDF.
    if (report.pdfPath && fs.existsSync(report.pdfPath)) {
      fs.unlink(report.pdfPath, () => {});
    }
    await report.deleteOne();

    res.json({ message: 'Report deleted', accountRemoved: false, reportsDeleted: 1 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
