const express = require('express');
const User = require('../models/User');
const Signal = require('../models/Signal');
const Report = require('../models/Report');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

function toStringArray(value) {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map(v => v.trim()).filter(Boolean);
  return [];
}

// The user's accounts, each with its signal count, its pitch lens and the state
// of its most recent report - everything the accounts board needs in one call.
router.get('/', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('watchlist.companyId');
    const entries = (user.watchlist || []).filter(w => w.companyId);
    const companyIds = entries.map(w => w.companyId._id);

    const [counts, reports] = await Promise.all([
      Signal.aggregate([
        { $match: { companyId: { $in: companyIds } } },
        { $group: { _id: '$companyId', count: { $sum: 1 } } },
      ]),
      Report.find({ userId: user._id, companyId: { $in: companyIds } })
        .select('companyId status progress error score.value score.band generatedAt')
        .sort({ generatedAt: -1 }),
    ]);

    const countByCompany = new Map(counts.map(c => [c._id.toString(), c.count]));

    // find() is sorted newest-first, so the first hit per company is the latest
    const latestReport = new Map();
    reports.forEach(r => {
      const key = r.companyId.toString();
      if (!latestReport.has(key)) latestReport.set(key, r);
    });

    res.json(entries.map(entry => {
      const company = entry.companyId;
      const key = company._id.toString();
      const report = latestReport.get(key);

      return {
        ...company.toObject(),
        signalCount: countByCompany.get(key) || 0,
        keywords: entry.keywords || [],
        notes: entry.notes,
        addedAt: entry.addedAt,
        // Empty keywords means the account inherits the profile default
        effectiveKeywords: entry.keywords?.length ? entry.keywords : (user.profile?.keywords || []),
        latestReport: report
          ? {
              _id: report._id,
              status: report.status,
              progress: report.progress,
              error: report.error,
              score: report.score?.value,
              band: report.score?.band,
              generatedAt: report.generatedAt,
            }
          : null,
      };
    }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Change the pitch lens for a single account without touching the profile
router.patch('/:companyId', authenticate, async (req, res) => {
  try {
    const entry = (req.user.watchlist || []).find(
      w => w.companyId?.toString() === req.params.companyId
    );

    if (!entry) return res.status(404).json({ error: 'Account not in your list' });

    if (req.body.keywords !== undefined) entry.keywords = toStringArray(req.body.keywords);
    if (req.body.notes !== undefined) entry.notes = req.body.notes;

    await req.user.save();

    res.json({
      message: 'Account updated',
      keywords: entry.keywords,
      notes: entry.notes,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
