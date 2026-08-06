const express = require('express');
const ApiKey = require('../models/ApiKey');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// API key management. Owners and admins only - a key reads every report the
// tenant has ever generated, so it is an admin-tier credential.

// List this tenant's keys, newest first. Never includes the secret.
router.get('/', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    if (!req.organization) return res.json([]);

    const keys = await ApiKey.find({ organizationId: req.organization._id }).sort({ createdAt: -1 });

    res.json(keys);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mint a key. The plaintext is in this response and nowhere else, ever again.
router.post('/', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    if (!req.organization) {
      return res.status(404).json({ error: 'No organization linked to this account' });
    }

    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Give the key a name so you can recognise it' });

    const active = await ApiKey.countDocuments({
      organizationId: req.organization._id,
      revokedAt: { $exists: false },
    });
    if (active >= 25) {
      return res.status(400).json({ error: 'You already have 25 active keys. Revoke one first.' });
    }

    const minted = ApiKey.mint();

    const record = await ApiKey.create({
      organizationId: req.organization._id,
      name,
      hash: minted.hash,
      prefix: minted.prefix,
      last4: minted.last4,
      createdBy: req.user._id,
      createdByName: `${req.user.firstName} ${req.user.lastName}`.trim(),
    });

    res.status(201).json({
      message: 'API key created. Copy it now - it is not shown again.',
      key: minted.key,
      apiKey: record.toJSON(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rename a key
router.patch('/:id', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const record = await ApiKey.findOne({
      _id: req.params.id,
      organizationId: req.organization?._id,
    });
    if (!record) return res.status(404).json({ error: 'API key not found' });

    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'A name is required' });

    record.name = name;
    await record.save();

    res.json({ message: 'API key renamed', apiKey: record.toJSON() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Revoke. The row is kept so the usage history stays auditable.
router.delete('/:id', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const record = await ApiKey.findOne({
      _id: req.params.id,
      organizationId: req.organization?._id,
    });
    if (!record) return res.status(404).json({ error: 'API key not found' });

    if (!record.revokedAt) {
      record.revokedAt = new Date();
      record.revokedBy = req.user._id;
      await record.save();
    }

    res.json({ message: 'API key revoked', apiKey: record.toJSON() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
