const express = require('express');
const Organization = require('../models/Organization');
const User = require('../models/User');
const { authenticate, authorize, normalizeDomain, domainFromEmail } = require('../middleware/auth');

const router = express.Router();

function toStringArray(value) {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map(v => v.trim()).filter(Boolean);
  return [];
}

// [{ title, keywords }] - a bare string is accepted as a title with no keywords
function toTitleRules(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => (typeof item === 'string'
      ? { title: item.trim(), keywords: [] }
      : { title: String(item?.title || '').trim(), keywords: toStringArray(item?.keywords) }))
    .filter(rule => rule.title);
}

// [{ name, priority }] - same leniency, so a plain list of names still works
function toTopics(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => (typeof item === 'string'
      ? { name: item.trim(), priority: 'normal' }
      : { name: String(item?.name || '').trim(), priority: item?.priority === 'high' ? 'high' : 'normal' }))
    .filter(topic => topic.name);
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
    const scalar = ['name', 'website', 'industry', 'headquarters', 'employeeBand', 'description', 'capabilityNotes',
      'productFeatures', 'problemsSolved', 'outcomesDelivered', 'competitorsDifferentiation',
      'caseStudies', 'industryTerminology'];
    const lists = ['capabilities', 'valuePropositions', 'differentiators', 'proofPoints',
      'targetIndustries', 'targetDepartments', 'targetRoles', 'relevantTechnologies'];

    scalar.forEach(field => {
      if (req.body[field] !== undefined) org[field] = req.body[field];
    });
    lists.forEach(field => {
      if (req.body[field] !== undefined) org[field] = toStringArray(req.body[field]);
    });

    ['relevantContactTitles', 'relevantHiringTitles'].forEach(field => {
      if (req.body[field] !== undefined) org[field] = toTitleRules(req.body[field]);
    });
    if (req.body.relevantTopics !== undefined) {
      org.relevantTopics = toTopics(req.body.relevantTopics);
    }

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

    // Same shape as GET /me, so the client can swap the org in state without
    // losing the seat counts it was already showing.
    const seatsUsed = await User.countDocuments({ organizationId: org._id });
    res.json({
      ...org.toObject(),
      seatsUsed,
      seatsRemaining: Math.max(0, (org.subscription?.seats || 0) - seatsUsed),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

const MEMBER_FIELDS = 'firstName lastName email jobTitle role profile preferences lastLogin createdAt';

// Who may act on whom. An admin runs the team but stops at their own tier: only
// the owner can touch another admin, and nobody edits or removes the owner.
// Returns an { status, error } to send, or null when the action is allowed.
function guardTarget(actor, target, { selfAllowed = true } = {}) {
  if (!target) return { status: 404, error: 'Member not found' };

  const isSelf = String(target._id) === String(actor._id);
  if (isSelf) {
    return selfAllowed ? null : { status: 403, error: 'You cannot do that to your own account' };
  }

  if (target.role === 'owner') {
    return { status: 403, error: 'The owner account cannot be changed here' };
  }
  if (target.role === 'admin' && actor.role !== 'owner') {
    return { status: 403, error: 'Only the owner can manage another admin' };
  }
  return null;
}

function loadMember(req) {
  return User.findOne({ _id: req.params.id, organizationId: req.organization?._id });
}

// Team roster. `q` narrows by name or email so search covers everyone, not just
// the page the browser is holding.
router.get('/members', authenticate, async (req, res) => {
  try {
    if (!req.organization) return res.json([]);

    const query = { organizationId: req.organization._id };
    const q = String(req.query.q || '').trim();
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ firstName: rx }, { lastName: rx }, { email: rx }];
    }

    const members = await User.find(query).select(MEMBER_FIELDS).sort({ createdAt: 1 });

    res.json(members);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add a seat directly, without the invitee going through signup
router.post('/members', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const org = req.organization;
    if (!org) return res.status(404).json({ error: 'No organization linked to this account' });

    const { firstName, lastName, email, password, jobTitle } = req.body;
    const role = req.body.role || 'member';

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are required' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!['admin', 'member'].includes(role)) {
      return res.status(400).json({ error: 'Role must be admin or member' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    // A seat may only be created on a domain this tenant owns, otherwise the
    // new account would resolve to a different organization at login.
    const domain = domainFromEmail(normalizedEmail);
    if (!domain || !(org.domains || []).includes(domain)) {
      return res.status(400).json({
        error: `Use a company address. ${org.name} covers ${(org.domains || []).map(d => `@${d}`).join(', ') || 'no domains yet'}.`,
      });
    }

    if (await User.findOne({ email: normalizedEmail })) {
      return res.status(409).json({ error: 'That email already has an account' });
    }

    const seatsUsed = await User.countDocuments({ organizationId: org._id });
    if (org.subscription?.seats && seatsUsed >= org.subscription.seats) {
      return res.status(403).json({
        error: `All ${org.subscription.seats} seats are in use. Add seats before inviting anyone else.`,
      });
    }

    const member = new User({
      firstName: String(firstName).trim(),
      lastName: String(lastName).trim(),
      email: normalizedEmail,
      password,
      jobTitle,
      organizationId: org._id,
      company: org.name,
      role,
      // The new seat inherits the org defaults; they set their own focus on
      // first sign-in, which is what flips completedOnboarding.
      profile: {
        targetDepartments: org.targetDepartments || [],
        targetRoles: org.targetRoles || [],
        completedOnboarding: false,
      },
    });

    await member.save();

    res.status(201).json({ message: 'User added', member: member.toJSON() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Edit a teammate: name, job title, role, alerts, or a new password
router.patch('/members/:id', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const member = await loadMember(req);
    const denied = guardTarget(req.user, member);
    if (denied) return res.status(denied.status).json({ error: denied.error });

    const isSelf = String(member._id) === String(req.user._id);

    ['firstName', 'lastName', 'jobTitle'].forEach(field => {
      if (req.body[field] !== undefined) member[field] = String(req.body[field]).trim();
    });

    if (req.body.role !== undefined && req.body.role !== member.role) {
      if (!['admin', 'member'].includes(req.body.role)) {
        return res.status(400).json({ error: 'Role must be admin or member' });
      }
      // Self-demotion would lock the last admin out of this screen
      if (isSelf) return res.status(403).json({ error: 'You cannot change your own role' });
      member.role = req.body.role;
    }

    if (req.body.emailAlerts !== undefined) {
      member.preferences = { ...(member.preferences?.toObject?.() || member.preferences || {}) };
      member.preferences.emailAlerts = Boolean(req.body.emailAlerts);
    }

    if (req.body.password) {
      if (String(req.body.password).length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }
      member.password = req.body.password; // hashed by the pre-save hook
    }

    member.updatedAt = new Date();
    await member.save();

    res.json({ message: 'User updated', member: member.toJSON() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Promote/demote a teammate
router.patch('/members/:id/role', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const { role } = req.body;

    if (!['admin', 'member'].includes(role)) {
      return res.status(400).json({ error: 'Role must be admin or member' });
    }

    const member = await loadMember(req);
    const denied = guardTarget(req.user, member, { selfAllowed: false });
    if (denied) return res.status(denied.status).json({ error: denied.error });

    member.role = role;
    await member.save();

    res.json({ message: 'Role updated', member: member.toJSON() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Remove a seat. The reports and accounts they created stay with the tenant.
router.delete('/members/:id', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const member = await loadMember(req);
    const denied = guardTarget(req.user, member, { selfAllowed: false });
    if (denied) return res.status(denied.status).json({ error: denied.error });

    await member.deleteOne();

    res.json({ message: 'User removed', id: req.params.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
