const express = require('express');
const Alert = require('../models/Alert');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Get user's alerts
router.get('/', authenticate, async (req, res) => {
  try {
    const alerts = await Alert.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json(alerts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create alert
router.post('/', authenticate, async (req, res) => {
  try {
    const { companyId, companyName, title, description, type, triggerType, triggerValue } = req.body;

    const alert = new Alert({
      userId: req.user._id,
      companyId: companyId || undefined,
      companyName,
      title,
      description,
      type,
      triggerType,
      triggerValue,
    });

    await alert.save();
    res.status(201).json(alert);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Toggle alert
router.patch('/:id/toggle', authenticate, async (req, res) => {
  try {
    // Scope by userId: any authenticated user could previously toggle any
    // other user's alert. A missing id also threw instead of returning 404.
    const alert = await Alert.findOne({ _id: req.params.id, userId: req.user._id });

    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    alert.isActive = !alert.isActive;
    alert.updatedAt = new Date();
    await alert.save();
    res.json(alert);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete alert
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const alert = await Alert.findOneAndDelete({ _id: req.params.id, userId: req.user._id });

    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    res.json({ message: 'Alert deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
