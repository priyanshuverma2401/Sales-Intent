const express = require('express');
const fs = require('fs');
const mongoose = require('mongoose');
const Report = require('../models/Report');
const Company = require('../models/Company');
const User = require('../models/User');
const { authenticate, isManager, sameOrg } = require('../middleware/auth');
const reportService = require('../services/reportService');
const reportGenerator = require('../services/reportGenerator');

const router = express.Router();

function isAuthor(report, req) {
  return report.userId?.toString() === req.user._id.toString();
}

// Everyone in the tenant reads everything the tenant produced - a member is
// meant to learn from a colleague's research, not be walled off from it.
function canRead(report, req) {
  return isAuthor(report, req) || sameOrg(report, req);
}

// Deleting is the asymmetric one: an owner may remove anything in the tenant,
// a member may only remove what they generated themselves.
function canDelete(report, req) {
  if (isAuthor(report, req)) return true;
  return isManager(req.user) && sameOrg(report, req);
}

// ---------------------------------------------------------------------------
// Generate a report for one prospect
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

    res.status(202).json({
      message: 'Report generation started',
      reportId: report._id,
      status: 'pending',
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
// Options for the report filters: who has written reports, and through which
// verticals. Derived from the whole visible set, so the dropdowns stay complete
// no matter how narrow the current filter is.
// Declared before '/:id' so "filters" is never read as an id.
// ---------------------------------------------------------------------------
router.get('/filters', authenticate, async (req, res) => {
  try {
    const scope = visibleScope(req);

    const [authorIds, verticals] = await Promise.all([
      Report.distinct('userId', scope),
      Report.distinct('context.vertical', scope),
    ]);

    const authors = await User.find({ _id: { $in: authorIds.filter(Boolean) } })
      .select('firstName lastName email')
      .sort({ firstName: 1, lastName: 1 });

    res.json({
      authors: authors.map(a => ({
        _id: a._id,
        name: `${a.firstName || ''} ${a.lastName || ''}`.trim() || a.email,
      })),
      verticals: verticals.filter(v => typeof v === 'string' && v.trim()).sort(),
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
//   ?vertical=<name> the lens it was written through
// ---------------------------------------------------------------------------
router.get('/', authenticate, async (req, res) => {
  try {
    const scope = visibleScope(req);
    const { q, author, vertical } = req.query;

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
    if (vertical && vertical !== 'all') {
      conditions.push({ 'context.vertical': String(vertical) });
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
      ].join(' '))
      .populate('userId', 'firstName lastName email')
      .sort({ generatedAt: -1 })
      .limit(120);

    const manages = isManager(req.user);
    const me = req.user._id.toString();

    res.json(reports.map(report => {
      const author = report.userId;
      const mine = author?._id?.toString() === me;

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
        canDelete: mine || manages,
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
      // Only needed when the report predates accountAddedAt being stamped on it
      report.accountAddedAt || !report.companyId
        ? null
        : Company.findById(report.companyId).select('addedAt'),
    ]);

    res.json({
      ...report.toObject(),
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
// ---------------------------------------------------------------------------
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });

    // Distinguish "not yours" from "does not exist": a member can see this
    // report in the list, so a 404 here would read as a bug rather than a rule.
    if (!canDelete(report, req)) {
      return res.status(403).json({
        error: canRead(report, req)
          ? 'Only the person who generated this report, or an owner, can delete it'
          : 'Not authorized to delete this report',
      });
    }

    if (report.pdfPath && fs.existsSync(report.pdfPath)) {
      fs.unlink(report.pdfPath, () => {});
    }
    await report.deleteOne();

    res.json({ message: 'Report deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
