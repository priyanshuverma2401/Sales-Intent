const express = require('express');
const Signal = require('../models/Signal');
const User = require('../models/User');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Ids of the companies this user watches
async function watchedCompanyIds(userId) {
  const user = await User.findById(userId);
  return (user?.watchlist || []).map(w => w.companyId).filter(Boolean);
}

// Get signals for watched companies
router.get('/', authenticate, async (req, res) => {
  try {
    const { companyId, type, priority, days = 7 } = req.query;

    const watchedIds = await watchedCompanyIds(req.user._id);

    if (watchedIds.length === 0) {
      return res.json([]);
    }

    const dateFilter = new Date();
    dateFilter.setDate(dateFilter.getDate() - parseInt(days, 10));

    const filter = {
      companyId: { $in: watchedIds },
      createdAt: { $gte: dateFilter },
    };

    // Narrow to a single company only if it is one the user actually watches
    if (companyId && watchedIds.some(id => id.toString() === companyId)) {
      filter.companyId = companyId;
    }
    if (type) filter.type = type;
    if (priority) filter.priority = priority;

    const signals = await Signal.find(filter).sort({ createdAt: -1 }).limit(100);

    res.json(signals);
  } catch (error) {
    console.error('Signals fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get signal counts by category.
// Declared before '/:id' so "stats" is never treated as an id.
router.get('/stats/by-category', authenticate, async (req, res) => {
  try {
    const watchedIds = await watchedCompanyIds(req.user._id);

    if (watchedIds.length === 0) {
      return res.json([]);
    }

    const dateFilter = new Date();
    dateFilter.setDate(dateFilter.getDate() - 7);

    const stats = await Signal.aggregate([
      { $match: { companyId: { $in: watchedIds }, createdAt: { $gte: dateFilter } } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get signals by category
router.get('/categories/:category', authenticate, async (req, res) => {
  try {
    const { category } = req.params;
    const { days = 7 } = req.query;

    const watchedIds = await watchedCompanyIds(req.user._id);

    if (watchedIds.length === 0) {
      return res.json([]);
    }

    const dateFilter = new Date();
    dateFilter.setDate(dateFilter.getDate() - parseInt(days, 10));

    const signals = await Signal.find({
      companyId: { $in: watchedIds },
      type: category,
      createdAt: { $gte: dateFilter },
    })
      .sort({ createdAt: -1 })
      .limit(50);

    res.json(signals);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get signal details
router.get('/:id', authenticate, async (req, res) => {
  try {
    const signal = await Signal.findById(req.params.id);

    if (!signal) {
      return res.status(404).json({ error: 'Signal not found' });
    }

    // Only expose signals belonging to a watched company
    const watchedIds = await watchedCompanyIds(req.user._id);
    if (!watchedIds.some(id => id.toString() === signal.companyId.toString())) {
      return res.status(403).json({ error: 'Not authorized to view this signal' });
    }

    signal.isRead = true;
    await signal.save();

    res.json(signal);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark signal as read
router.patch('/:id/read', authenticate, async (req, res) => {
  try {
    const signal = await Signal.findById(req.params.id);

    if (!signal) {
      return res.status(404).json({ error: 'Signal not found' });
    }

    const watchedIds = await watchedCompanyIds(req.user._id);
    if (!watchedIds.some(id => id.toString() === signal.companyId.toString())) {
      return res.status(403).json({ error: 'Not authorized to modify this signal' });
    }

    signal.isRead = true;
    await signal.save();

    res.json(signal);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
