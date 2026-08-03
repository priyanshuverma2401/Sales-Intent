const express = require('express');
const Organization = require('../models/Organization');
const User = require('../models/User');
const { authenticate, authorize, normalizeDomain } = require('../middleware/auth');

const router = express.Router();

function toStringArray(value) {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map(v => v.trim()).filter(Boolean);
  return [];
}

// The current tenant, with seat usage
router.get('/me', authenticate, async (req, res) => {
  try {
    if (!req.organization) {
      return res.status(404).json({ error: 'No organization linked to this account' });
    }

    const seatsUsed = await User.countDocuments({ organizationId: req.organization._id });

    res.json({
      ...req.organization.toObject(),
      seatsUsed,
      seatsRemaining: Math.max(0, (req.organization.subscription?.seats || 0) - seatsUsed),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update the company profile that grounds every report
router.patch('/me', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    if (!req.organization) {
      return res.status(404).json({ error: 'No organization linked to this account' });
    }

    const org = req.organization;
    const scalar = ['name', 'website', 'industry', 'headquarters', 'employeeBand', 'description', 'capabilityNotes'];
    const lists = ['capabilities', 'valuePropositions', 'differentiators', 'proofPoints',
      'targetIndustries', 'targetDepartments', 'targetRoles'];

    scalar.forEach(field => {
      if (req.body[field] !== undefined) org[field] = req.body[field];
    });
    lists.forEach(field => {
      if (req.body[field] !== undefined) org[field] = toStringArray(req.body[field]);
    });

    if (req.body.domains !== undefined) {
      const domains = toStringArray(req.body.domains).map(normalizeDomain).filter(Boolean);

      // A domain may only entitle one tenant, so reject overlaps up front
      const clash = await Organization.findOne({
        _id: { $ne: org._id },
        domains: { $in: domains },
      });
      if (clash) {
        return res.status(409).json({ error: `A domain in that list is already used by ${clash.name}` });
      }
      if (domains.length === 0) {
        return res.status(400).json({ error: 'At least one email domain is required' });
      }
      org.domains = domains;
    }

    await org.save();

    // Keep the denormalised display name on seats in step with a rename
    if (req.body.name) {
      await User.updateMany({ organizationId: org._id }, { $set: { company: org.name } });
    }

    res.json(org);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Team roster
router.get('/members', authenticate, async (req, res) => {
  try {
    if (!req.organization) return res.json([]);

    const members = await User.find({ organizationId: req.organization._id })
      .select('firstName lastName email jobTitle role profile lastLogin createdAt')
      .sort({ createdAt: 1 });

    res.json(members);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Promote/demote a teammate. Owners cannot be changed by anyone but themselves.
router.patch('/members/:id/role', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const { role } = req.body;

    if (!['admin', 'member'].includes(role)) {
      return res.status(400).json({ error: 'Role must be admin or member' });
    }

    const member = await User.findOne({
      _id: req.params.id,
      organizationId: req.organization?._id,
    });

    if (!member) return res.status(404).json({ error: 'Member not found' });
    if (member.role === 'owner') return res.status(403).json({ error: 'The owner role cannot be changed' });

    member.role = role;
    await member.save();

    res.json({ message: 'Role updated', member: member.toJSON() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
