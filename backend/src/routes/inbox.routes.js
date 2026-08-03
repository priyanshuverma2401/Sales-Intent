const express = require('express');
const Inbox = require('../models/Inbox');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Get inbox messages
router.get('/', authenticate, async (req, res) => {
  try {
    const { archived = false } = req.query;
    const messages = await Inbox.find({
      userId: req.user._id,
      isArchived: archived === 'true',
    }).sort({ createdAt: -1 });

    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark as read.
// Scoped by userId - findByIdAndUpdate let any authenticated user mutate
// another user's messages, and returned null instead of 404 for bad ids.
router.patch('/:id/read', authenticate, async (req, res) => {
  try {
    const message = await Inbox.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { isRead: true, readAt: new Date() },
      { new: true }
    );

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    res.json(message);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Archive message
router.patch('/:id/archive', authenticate, async (req, res) => {
  try {
    const message = await Inbox.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { isArchived: true },
      { new: true }
    );

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    res.json(message);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Unread count for the sidebar badge
router.get('/unread-count', authenticate, async (req, res) => {
  try {
    const count = await Inbox.countDocuments({
      userId: req.user._id,
      isRead: false,
      isArchived: false,
    });

    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
