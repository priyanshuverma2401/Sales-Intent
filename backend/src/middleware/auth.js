const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Organization = require('../models/Organization');

// Strip protocol/www/path so "https://www.acme.com/careers" and "acme.com"
// resolve to the same tenant key.
function normalizeDomain(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0];
}

function domainFromEmail(email) {
  return String(email || '').trim().toLowerCase().split('@')[1] || '';
}

exports.normalizeDomain = normalizeDomain;
exports.domainFromEmail = domainFromEmail;

exports.authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = user;
    // Loaded once here so routes never have to re-query the tenant
    req.organization = user.organizationId
      ? await Organization.findById(user.organizationId)
      : null;

    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Access is now decided by which subscribing organization owns the email
// domain, not by a hardcoded allowlist in the environment.
exports.resolveOrganizationByEmail = async (req, res, next) => {
  const domain = domainFromEmail(req.body.email);

  if (!domain) {
    return res.status(400).json({ error: 'A valid work email is required' });
  }

  const organization = await Organization.findOne({ domains: domain });

  if (!organization) {
    return res.status(403).json({
      error: `No SalesMotion subscription found for @${domain}. Ask your admin to register your company, or register it yourself.`,
      code: 'ORG_NOT_REGISTERED',
      domain,
    });
  }

  if (organization.subscription?.status === 'cancelled') {
    return res.status(403).json({ error: `The subscription for ${organization.name} is not active.` });
  }

  req.organization = organization;
  next();
};

exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    next();
  };
};
