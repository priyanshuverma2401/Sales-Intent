const express = require('express');
const User = require('../models/User');
const Signal = require('../models/Signal');
const Report = require('../models/Report');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Matches a company against a free-text query. The watchlist is an embedded
// array rather than its own collection, so this is a plain predicate rather
// than a Mongo filter - but the query still arrives as ?q= like every other
// list in the API, and the client never filters locally.
function matchesQuery(company, q) {
  if (!q) return true;
  const needle = q.toLowerCase();

  return [company.name, company.ticker, company.industry, company.country]
    .filter(Boolean)
    .some(field => String(field).toLowerCase().includes(needle));
}

// The user's accounts, each with its signal count and the state of its most
// recent report - everything the accounts board needs in one call.
//   ?q=hsbc   company name, ticker, industry or country
router.get('/', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('watchlist.companyId');
    const all = (user.watchlist || []).filter(w => w.companyId);

    const q = String(req.query.q || '').trim();
    const entries = q ? all.filter(w => matchesQuery(w.companyId, q)) : all;

    // Unfiltered size, so the UI can say "1 of 12" without a second request
    res.set('X-Total-Count', String(all.length));

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
        notes: entry.notes,
        addedAt: entry.addedAt,
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

// Personal notes on one account. What a report says is decided by the company
// profile, so there is nothing per-account to steer.
router.patch('/:companyId', authenticate, async (req, res) => {
  try {
    const entry = (req.user.watchlist || []).find(
      w => w.companyId?.toString() === req.params.companyId
    );

    if (!entry) return res.status(404).json({ error: 'Account not in your list' });

    if (req.body.notes !== undefined) entry.notes = req.body.notes;

    await req.user.save();

    res.json({ message: 'Account updated', notes: entry.notes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
