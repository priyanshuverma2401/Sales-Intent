const express = require('express');
const fs = require('fs');
const Report = require('../models/Report');
const Company = require('../models/Company');
const { authenticate } = require('../middleware/auth');
const reportService = require('../services/reportService');
const reportGenerator = require('../services/reportGenerator');

const router = express.Router();

function canRead(report, req) {
  const isOwner = report.userId?.toString() === req.user._id.toString();
  const isOrgAdmin =
    ['owner', 'admin'].includes(req.user.role) &&
    report.organizationId?.toString() === req.organization?._id?.toString();
  return isOwner || isOrgAdmin;
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

// ---------------------------------------------------------------------------
// List the signed-in user's reports (summary payload only)
// ---------------------------------------------------------------------------
router.get('/', authenticate, async (req, res) => {
  try {
    const reports = await Report.find({ userId: req.user._id })
      .select([
        'companyName', 'companyId', 'ticker', 'status', 'progress', 'error',
        'score.value', 'score.band', 'score.summary',
        'context', 'generatedAt', 'aiModel', 'pdfFileName',
        'fastFacts.industry', 'fastFacts.logoUrl', 'fastFacts.headquarters',
      ].join(' '))
      .sort({ generatedAt: -1 })
      .limit(60);

    res.json(reports);
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

    res.json(report);
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
    const report = await Report.findOne({ _id: req.params.id, userId: req.user._id });
    if (!report) return res.status(404).json({ error: 'Report not found' });

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
