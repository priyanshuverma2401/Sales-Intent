const express = require('express');
const CrmConnection = require('../models/CrmConnection');
const CrmRecord = require('../models/CrmRecord');
const Company = require('../models/Company');
const crmService = require('../services/crm');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// CRM integrations. Admin-tier throughout: a connection exposes the tenant's
// whole pipeline to every report the tenant generates.

const PROVIDERS = {
  salesforce: {
    label: 'Salesforce',
    required: ['clientId', 'clientSecret', 'refreshToken'],
    optional: ['loginUrl'],
  },
  zoho: {
    label: 'Zoho CRM',
    required: ['clientId', 'clientSecret', 'refreshToken'],
    optional: ['accountsUrl'],
  },
};

function requireProvider(req, res) {
  const provider = String(req.params.provider || '').toLowerCase();
  if (!PROVIDERS[provider]) {
    res.status(400).json({ error: `Unknown CRM provider: ${req.params.provider}` });
    return null;
  }
  return provider;
}

async function loadConnection(req, res, provider) {
  const connection = await CrmConnection.findOne({
    organizationId: req.organization?._id,
    provider,
  });
  if (!connection) {
    res.status(404).json({ error: `No ${PROVIDERS[provider].label} connection to work with` });
    return null;
  }
  return connection;
}

// Current state of every provider, connected or not
router.get('/', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    if (!req.organization) return res.json({ providers: [], connections: [] });

    const connections = await CrmConnection.find({ organizationId: req.organization._id });
    const matched = await CrmRecord.countDocuments({
      organizationId: req.organization._id,
      matched: true,
    });

    res.json({
      providers: Object.entries(PROVIDERS).map(([id, meta]) => ({ id, label: meta.label })),
      connections: connections.map(c => c.toJSON()),
      matchedAccounts: matched,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Connect. The credentials are proven against the CRM before anything is saved.
router.post('/:provider/connect', authenticate, authorize('owner', 'admin'), async (req, res) => {
  const provider = requireProvider(req, res);
  if (!provider) return;

  try {
    if (!req.organization) {
      return res.status(404).json({ error: 'No organization linked to this account' });
    }

    const missing = PROVIDERS[provider].required.filter(field => !String(req.body[field] || '').trim());
    if (missing.length) {
      return res.status(400).json({ error: `Missing required field(s): ${missing.join(', ')}` });
    }

    const connection = await crmService.connect({
      organization: req.organization,
      user: req.user,
      provider,
      credentials: {
        clientId: String(req.body.clientId).trim(),
        clientSecret: String(req.body.clientSecret).trim(),
        refreshToken: String(req.body.refreshToken).trim(),
        loginUrl: req.body.loginUrl ? String(req.body.loginUrl).trim() : undefined,
        accountsUrl: req.body.accountsUrl ? String(req.body.accountsUrl).trim() : undefined,
      },
    });

    res.status(201).json({
      message: `${PROVIDERS[provider].label} connected`,
      connection: connection.toJSON(),
    });
  } catch (error) {
    // A rejected credential is the caller's problem, not a server fault
    res.status(400).json({ error: error.message, code: 'CRM_AUTH_FAILED' });
  }
});

// Re-check a stored connection
router.post('/:provider/test', authenticate, authorize('owner', 'admin'), async (req, res) => {
  const provider = requireProvider(req, res);
  if (!provider) return;

  try {
    const connection = await loadConnection(req, res, provider);
    if (!connection) return;

    const result = await crmService.test(connection);
    res.json({ message: `${PROVIDERS[provider].label} is reachable`, ...result });
  } catch (error) {
    res.status(400).json({ error: error.message, code: 'CRM_AUTH_FAILED' });
  }
});

// Sync every watched account. Runs in the background: a few hundred accounts is
// minutes of CRM calls, far longer than a request should be held open for.
router.post('/:provider/sync', authenticate, authorize('owner', 'admin'), async (req, res) => {
  const provider = requireProvider(req, res);
  if (!provider) return;

  try {
    const connection = await loadConnection(req, res, provider);
    if (!connection) return;

    const companies = await crmService.organizationCompanies(connection.organizationId);

    setImmediate(() => {
      crmService
        .syncOrganization(connection)
        .then(result => console.log(`✅ CRM sync finished for ${req.organization.name}:`, result))
        .catch(error => console.error('❌ CRM sync failed:', error.message));
    });

    res.status(202).json({
      message: `Syncing ${companies.length} account${companies.length === 1 ? '' : 's'} from ${PROVIDERS[provider].label}. Refresh in a moment.`,
      accounts: companies.length,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Sync one account on demand
router.post('/:provider/sync/:companyId', authenticate, authorize('owner', 'admin'), async (req, res) => {
  const provider = requireProvider(req, res);
  if (!provider) return;

  try {
    const connection = await loadConnection(req, res, provider);
    if (!connection) return;

    const company = await Company.findById(req.params.companyId);
    if (!company) return res.status(404).json({ error: 'Account not found' });

    const { record, signalsCreated, error } = await crmService.syncCompany(connection, company);

    res.json({
      message: record.matched
        ? `${company.name} matched in ${PROVIDERS[provider].label}`
        : `${company.name} was not found in ${PROVIDERS[provider].label}`,
      matched: record.matched,
      opportunities: record.opportunities?.length || 0,
      contacts: record.contacts?.length || 0,
      signalsCreated,
      error,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// What the CRM holds for one account, for the account detail view
router.get('/records/:companyId', authenticate, async (req, res) => {
  try {
    const record = await CrmRecord.findOne({
      organizationId: req.organization?._id,
      companyId: req.params.companyId,
    });

    if (!record) return res.json(null);
    res.json({ ...record.toObject(), context: record.toContext() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Toggle what the CRM is allowed to influence, and how stale a snapshot may get
router.patch('/:provider', authenticate, authorize('owner', 'admin'), async (req, res) => {
  const provider = requireProvider(req, res);
  if (!provider) return;

  try {
    const connection = await loadConnection(req, res, provider);
    if (!connection) return;

    ['reports', 'signals', 'score'].forEach(key => {
      if (req.body.usage?.[key] !== undefined) {
        connection.usage[key] = Boolean(req.body.usage[key]);
      }
    });

    if (req.body.freshnessHours !== undefined) {
      const hours = Number(req.body.freshnessHours);
      if (!Number.isFinite(hours) || hours < 1 || hours > 720) {
        return res.status(400).json({ error: 'Freshness must be between 1 and 720 hours' });
      }
      connection.freshnessHours = hours;
    }

    await connection.save();

    res.json({ message: 'Integration updated', connection: connection.toJSON() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Disconnect. Drops the stored credentials and the cached CRM snapshots; the
// signals already raised stay, because they describe things that did happen.
router.delete('/:provider', authenticate, authorize('owner', 'admin'), async (req, res) => {
  const provider = requireProvider(req, res);
  if (!provider) return;

  try {
    const connection = await loadConnection(req, res, provider);
    if (!connection) return;

    await CrmRecord.deleteMany({ organizationId: connection.organizationId, provider });
    await connection.deleteOne();

    res.json({ message: `${PROVIDERS[provider].label} disconnected` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
