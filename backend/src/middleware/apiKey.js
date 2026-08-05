const ApiKey = require('../models/ApiKey');
const Organization = require('../models/Organization');

// Authenticates the public read API. Unlike `authenticate`, there is no user
// here: a key belongs to the tenant, so req.organization is the whole identity.
//
// Accepts either header:
//   X-API-Key: sm_live_...
//   Authorization: Bearer sm_live_...
exports.authenticateApiKey = async (req, res, next) => {
  try {
    const raw =
      req.header('X-API-Key') ||
      String(req.header('Authorization') || '').replace(/^Bearer\s+/i, '');

    if (!raw.trim()) {
      return res.status(401).json({
        error: 'Provide your API key in the X-API-Key header',
        code: 'MISSING_API_KEY',
      });
    }

    const record = await ApiKey.findOne({ hash: ApiKey.hashKey(raw) });

    if (!record) {
      return res.status(401).json({ error: 'That API key is not valid', code: 'INVALID_API_KEY' });
    }
    if (record.revokedAt) {
      return res.status(401).json({ error: 'That API key has been revoked', code: 'REVOKED_API_KEY' });
    }

    const organization = await Organization.findById(record.organizationId);
    if (!organization) {
      return res.status(401).json({ error: 'That API key is not valid', code: 'INVALID_API_KEY' });
    }
    if (organization.subscription?.status === 'cancelled') {
      return res.status(403).json({
        error: `The subscription for ${organization.name} is not active`,
        code: 'SUBSCRIPTION_INACTIVE',
      });
    }

    req.organization = organization;
    req.apiKey = record;

    // Usage tracking must never fail or delay the request it is describing
    ApiKey.updateOne(
      { _id: record._id },
      { $set: { lastUsedAt: new Date() }, $inc: { requestCount: 1 } }
    ).catch(() => {});

    next();
  } catch (error) {
    res.status(500).json({ error: error.message, code: 'AUTH_ERROR' });
  }
};
