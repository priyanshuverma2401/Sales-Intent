const ActivityLog = require('../models/ActivityLog');
const Organization = require('../models/Organization');
const Report = require('../models/Report');
const Company = require('../models/Company');
const User = require('../models/User');
const { domainFromEmail } = require('../middleware/auth');

// ---------------------------------------------------------------------------
// What gets logged, and how it reads
//
// Recording happens in one place rather than in sixty route handlers. A handler
// that forgets to call a logger leaves a hole in the audit trail, and the hole
// is invisible until somebody goes looking for the entry that was never
// written - so the middleware sits above the whole API and every route is
// covered by default, whether or not anyone remembered it existed.
//
// Two things follow from that:
//
//   * A route with no rule below is still logged, under a name derived from its
//     path. New endpoints are recorded from the day they ship; the rule table
//     only decides how nicely the row reads.
//   * Reads are not logged, with three deliberate exceptions - opening a
//     report, downloading its PDF and exporting this log. Those are the reads
//     that matter when something has leaked. Logging every list request would
//     bury them under page views.
// ---------------------------------------------------------------------------

const OBJECT_ID = '([a-f\\d]{24})';

// Values that must never be written to the log, at any depth.
const SECRET_KEYS = /password|secret|token|credential|apikey|api_key|authorization|key$/i;

function redact(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 3) return '[…]';

  if (Array.isArray(value)) {
    return value.slice(0, 20).map(v => redact(v, depth + 1));
  }
  if (typeof value === 'object') {
    const out = {};
    Object.keys(value).slice(0, 30).forEach((key) => {
      out[key] = SECRET_KEYS.test(key) ? '[redacted]' : redact(value[key], depth + 1);
    });
    return out;
  }
  if (typeof value === 'string') {
    return value.length > 300 ? `${value.slice(0, 300)}…` : value;
  }
  return value;
}

// Which top-level fields a PATCH actually touched. More useful in a log than
// the values themselves: "changed capabilities, relevantTopics" tells an admin
// where to look without reprinting the whole company profile into the row.
function changedFields(body) {
  if (!body || typeof body !== 'object') return [];
  return Object.keys(body).filter(key => !SECRET_KEYS.test(key));
}

const person = u => `${u?.firstName || ''} ${u?.lastName || ''}`.trim() || u?.email || 'Someone';

// ---------------------------------------------------------------------------
// Rules, keyed by "<METHOD> <mounted route pattern>"
//
// `describe` receives the finished exchange - the request, the JSON the route
// sent back, and anything preloaded before the handler ran - and returns the
// human sentence plus what the action was aimed at.
// ---------------------------------------------------------------------------
const RULES = {
  // --- Sign-in and the account itself --------------------------------------
  'POST /api/auth/login': {
    action: ({ outcome }) => (outcome === 'failure' ? 'auth.login_failed' : 'auth.login'),
    category: 'auth',
    // A rejected password is the single most important thing in this log, so
    // failures are always kept - including the 401 that everything else skips.
    logFailures: true,
    describe: ({ res, req }) => ({
      description: res.statusCode >= 400
        ? `Failed sign-in attempt for ${String(req.body?.email || 'an unknown address').toLowerCase()}`
        : 'Signed in',
    }),
  },
  'POST /api/auth/logout': {
    action: 'auth.logout',
    category: 'auth',
    describe: () => ({ description: 'Signed out' }),
  },
  'POST /api/auth/register': {
    action: 'auth.register',
    category: 'auth',
    describe: () => ({ description: 'Created their own account through signup' }),
  },
  'POST /api/auth/register-organization': {
    action: 'auth.org_register',
    category: 'auth',
    describe: ({ body }) => ({
      description: `Registered ${body?.organization?.name || 'the company'} on SalesMotion`,
      target: { type: 'organization', label: body?.organization?.name },
    }),
  },
  'PATCH /api/auth/profile': {
    action: 'profile.update',
    category: 'account',
    describe: ({ req }) => ({
      description: `Updated their own profile (${changedFields(req.body).join(', ') || 'no fields'})`,
      metadata: { fields: changedFields(req.body) },
    }),
  },
  'POST /api/auth/change-password': {
    action: 'profile.password_change',
    category: 'security',
    logFailures: true,
    describe: ({ outcome }) => ({
      description: outcome === 'failure'
        ? 'Failed to change their password — the current one did not match'
        : 'Changed their password',
    }),
  },

  // --- Accounts ------------------------------------------------------------
  'POST /api/companies': {
    action: 'account.add',
    category: 'accounts',
    describe: ({ body, req }) => ({
      description: `Added ${body?.company?.name || req.body?.name || 'an account'} to the workspace${
        body?.reportId ? ' and started a report' : ''
      }`,
      target: { type: 'account', id: body?.company?._id, label: body?.company?.name || req.body?.name },
    }),
  },
  [`DELETE /api/companies/:id`]: {
    action: 'account.remove',
    category: 'accounts',
    describe: ({ preload, req }) => ({
      description: `Removed ${preload?.label || 'an account'} from the workspace`,
      target: { type: 'account', id: req.params?.id, label: preload?.label },
    }),
  },
  'POST /api/companies/:id/refresh': {
    action: 'account.refresh',
    category: 'accounts',
    describe: ({ body, req }) => ({
      description: `Refreshed the data on ${body?.companyName || 'an account'}`,
      target: { type: 'account', id: req.params?.id, label: body?.companyName },
      metadata: { newsFound: body?.newsFound, signalsCreated: body?.signalsCreated },
    }),
  },
  'PATCH /api/accounts/:companyId': {
    action: 'account.update',
    category: 'accounts',
    describe: ({ req }) => ({
      description: `Edited the settings on an account (${changedFields(req.body).join(', ') || 'no fields'})`,
      target: { type: 'account', id: req.params?.companyId },
      metadata: { fields: changedFields(req.body) },
    }),
  },

  // --- Reports -------------------------------------------------------------
  'POST /api/reports/:companyId': {
    action: 'report.generate',
    category: 'reports',
    describe: ({ body, preload, req }) => ({
      description: `Started a new report on ${preload?.label || 'an account'}`,
      target: { type: 'report', id: body?.reportId, label: preload?.label },
      metadata: { companyId: req.params?.companyId },
    }),
  },
  'GET /api/reports/:id': {
    action: 'report.view',
    category: 'reports',
    describe: ({ body, req }) => ({
      description: `Opened the report on ${body?.companyName || 'an account'}`,
      target: { type: 'report', id: req.params?.id, label: body?.companyName },
    }),
  },
  'GET /api/reports/:id/download': {
    action: 'report.download',
    category: 'reports',
    describe: ({ preload, req }) => ({
      description: `Downloaded the PDF of the report on ${preload?.label || 'an account'}`,
      target: { type: 'report', id: req.params?.id, label: preload?.label },
    }),
  },
  'POST /api/reports/:id/ask': {
    action: 'report.ask',
    category: 'reports',
    describe: ({ req }) => ({
      description: 'Asked a question of a report',
      target: { type: 'report', id: req.params?.id },
      metadata: { question: redact(req.body?.question) },
    }),
  },
  'DELETE /api/reports/:id': {
    action: 'report.delete',
    category: 'reports',
    describe: ({ preload, req }) => ({
      description: `Deleted the report on ${preload?.label || 'an account'}`,
      target: { type: 'report', id: req.params?.id, label: preload?.label },
    }),
  },

  // --- The company profile every report is written from --------------------
  'PATCH /api/organizations/me': {
    action: 'organization.update',
    category: 'settings',
    describe: ({ req }) => ({
      description: `Edited the company profile (${changedFields(req.body).join(', ') || 'no fields'})`,
      target: { type: 'organization', label: req.organization?.name },
      metadata: { fields: changedFields(req.body) },
    }),
  },

  // --- The team ------------------------------------------------------------
  'POST /api/organizations/members': {
    action: 'member.add',
    category: 'team',
    describe: ({ body, req }) => ({
      description: `Added ${body?.member?.email || req.body?.email || 'a teammate'} as ${
        body?.member?.role || req.body?.role || 'member'
      }`,
      target: { type: 'member', id: body?.member?._id, label: body?.member?.email || req.body?.email },
    }),
  },
  'PATCH /api/organizations/members/:id': {
    action: 'member.update',
    category: 'team',
    describe: ({ body, req }) => {
      const fields = changedFields(req.body);
      const passwordReset = Boolean(req.body?.password);
      return {
        description: passwordReset
          ? `Reset the password for ${body?.member?.email || 'a teammate'}`
          : `Edited ${body?.member?.email || 'a teammate'} (${fields.join(', ') || 'no fields'})`,
        target: { type: 'member', id: req.params?.id, label: body?.member?.email },
        metadata: { fields, passwordReset },
      };
    },
  },
  'PATCH /api/organizations/members/:id/role': {
    action: 'member.role_change',
    category: 'team',
    describe: ({ body, preload, req }) => ({
      description: `Changed ${body?.member?.email || 'a teammate'} from ${
        preload?.role || 'their previous role'
      } to ${body?.member?.role || req.body?.role}`,
      target: { type: 'member', id: req.params?.id, label: body?.member?.email },
      metadata: { from: preload?.role, to: body?.member?.role || req.body?.role },
    }),
  },
  'DELETE /api/organizations/members/:id': {
    action: 'member.remove',
    category: 'team',
    describe: ({ preload, req }) => ({
      description: `Removed ${preload?.label || 'a teammate'} from the organization`,
      target: { type: 'member', id: req.params?.id, label: preload?.label },
      metadata: { role: preload?.role },
    }),
  },

  // --- Alert rules ---------------------------------------------------------
  'POST /api/alerts': {
    action: 'alert.create',
    category: 'alerts',
    describe: ({ body }) => ({
      description: `Created the alert rule "${body?.title || 'untitled'}"`,
      target: { type: 'alert', id: body?._id, label: body?.title },
    }),
  },
  'PATCH /api/alerts/:id/toggle': {
    action: 'alert.toggle',
    category: 'alerts',
    describe: ({ body, req }) => ({
      description: `Turned the alert rule "${body?.title || 'untitled'}" ${body?.isActive ? 'on' : 'off'}`,
      target: { type: 'alert', id: req.params?.id, label: body?.title },
    }),
  },
  'DELETE /api/alerts/:id': {
    action: 'alert.delete',
    category: 'alerts',
    describe: ({ req }) => ({
      description: 'Deleted an alert rule',
      target: { type: 'alert', id: req.params?.id },
    }),
  },

  // --- Connected apps ------------------------------------------------------
  'POST /api/integrations/:provider/connect': {
    action: 'integration.connect',
    category: 'integrations',
    describe: ({ req }) => ({
      description: `Connected ${req.params?.provider} to the workspace`,
      target: { type: 'integration', label: req.params?.provider },
    }),
  },
  'POST /api/integrations/:provider/test': {
    action: 'integration.test',
    category: 'integrations',
    describe: ({ req, outcome }) => ({
      description: `Tested the ${req.params?.provider} connection — ${outcome === 'failure' ? 'it failed' : 'it worked'}`,
      target: { type: 'integration', label: req.params?.provider },
    }),
  },
  'POST /api/integrations/:provider/sync': {
    action: 'integration.sync',
    category: 'integrations',
    describe: ({ req, body }) => ({
      description: `Started a full ${req.params?.provider} sync${
        body?.accounts ? ` across ${body.accounts} accounts` : ''
      }`,
      target: { type: 'integration', label: req.params?.provider },
    }),
  },
  'POST /api/integrations/:provider/sync/:companyId': {
    action: 'integration.sync_account',
    category: 'integrations',
    describe: ({ req, body }) => ({
      description: `Synced one account from ${req.params?.provider}`,
      target: { type: 'account', id: req.params?.companyId, label: body?.company },
      metadata: { matched: body?.matched },
    }),
  },
  'PATCH /api/integrations/:provider': {
    action: 'integration.update',
    category: 'integrations',
    describe: ({ req }) => ({
      description: `Changed the ${req.params?.provider} settings`,
      target: { type: 'integration', label: req.params?.provider },
      metadata: { fields: changedFields(req.body) },
    }),
  },
  'DELETE /api/integrations/:provider': {
    action: 'integration.disconnect',
    category: 'integrations',
    describe: ({ req }) => ({
      description: `Disconnected ${req.params?.provider}`,
      target: { type: 'integration', label: req.params?.provider },
    }),
  },

  // --- API keys ------------------------------------------------------------
  // Security rather than settings: a key reads every report the tenant owns.
  'POST /api/api-keys': {
    action: 'apikey.create',
    category: 'security',
    describe: ({ body }) => ({
      description: `Created the API key "${body?.apiKey?.name || 'untitled'}"`,
      target: { type: 'apiKey', id: body?.apiKey?._id, label: body?.apiKey?.name },
    }),
  },
  'PATCH /api/api-keys/:id': {
    action: 'apikey.rename',
    category: 'security',
    describe: ({ body, req }) => ({
      description: `Renamed an API key to "${body?.apiKey?.name || 'untitled'}"`,
      target: { type: 'apiKey', id: req.params?.id, label: body?.apiKey?.name },
    }),
  },
  'DELETE /api/api-keys/:id': {
    action: 'apikey.revoke',
    category: 'security',
    describe: ({ body, req }) => ({
      description: `Revoked the API key "${body?.apiKey?.name || 'untitled'}"`,
      target: { type: 'apiKey', id: req.params?.id, label: body?.apiKey?.name },
    }),
  },

  // --- Inbox and signals ---------------------------------------------------
  'PATCH /api/inbox/:id/read': {
    action: 'inbox.read',
    category: 'inbox',
    describe: () => ({ description: 'Read an inbox message' }),
  },
  'PATCH /api/inbox/:id/archive': {
    action: 'inbox.archive',
    category: 'inbox',
    describe: () => ({ description: 'Archived an inbox message' }),
  },
  'PATCH /api/signals/:id/read': {
    action: 'signal.read',
    category: 'signals',
    describe: () => ({ description: 'Marked a buying signal as read' }),
  },

  // --- The log itself ------------------------------------------------------
  // Exporting the audit trail is itself an audited act.
  'GET /api/analytics/activity/export': {
    action: 'audit.export',
    category: 'security',
    describe: ({ req }) => ({
      description: 'Exported the activity log to CSV',
      metadata: { filters: redact(req.query) },
    }),
  },
};

// ---------------------------------------------------------------------------
// Preloads
//
// A handful of actions destroy the thing they are about, so the label has to be
// read before the handler runs - after a delete there is nothing left to name.
// Matched on the raw path, because the route pattern is not known until Express
// has finished routing.
// ---------------------------------------------------------------------------
const PRELOADS = [
  {
    method: 'DELETE',
    test: new RegExp(`^/api/reports/${OBJECT_ID}$`, 'i'),
    load: async (id) => {
      const report = await Report.findById(id).select('companyName').lean();
      return report ? { label: report.companyName } : null;
    },
  },
  {
    method: 'GET',
    test: new RegExp(`^/api/reports/${OBJECT_ID}/download$`, 'i'),
    load: async (id) => {
      const report = await Report.findById(id).select('companyName').lean();
      return report ? { label: report.companyName } : null;
    },
  },
  {
    // The 202 that starts a report only carries its id, so the account it is
    // about has to be read on the way in.
    method: 'POST',
    test: new RegExp(`^/api/reports/${OBJECT_ID}$`, 'i'),
    load: async (id) => {
      const company = await Company.findById(id).select('name').lean();
      return company ? { label: company.name } : null;
    },
  },
  {
    method: 'DELETE',
    test: new RegExp(`^/api/companies/${OBJECT_ID}$`, 'i'),
    load: async (id) => {
      const company = await Company.findById(id).select('name').lean();
      return company ? { label: company.name } : null;
    },
  },
  {
    method: 'DELETE',
    test: new RegExp(`^/api/organizations/members/${OBJECT_ID}$`, 'i'),
    load: async (id) => {
      const member = await User.findById(id).select('firstName lastName email role').lean();
      return member ? { label: member.email, role: member.role, name: person(member) } : null;
    },
  },
  {
    method: 'PATCH',
    test: new RegExp(`^/api/organizations/members/${OBJECT_ID}/role$`, 'i'),
    load: async (id) => {
      const member = await User.findById(id).select('email role').lean();
      return member ? { label: member.email, role: member.role } : null;
    },
  },
];

// Paths the log ignores outright: health probes (a monitor hits them every
// thirty seconds), the machine-to-machine read API, which is rate-limited and
// keyed rather than seated, and the log's own read endpoints - browsing the
// audit trail must not fill the audit trail.
const IGNORED = [
  /^\/api\/health/,
  /^\/api\/v1\//,
  /^\/api\/analytics\/(overview|filters)/,
  // Reading the log is not itself an event. Exporting it is, so that one path
  // is deliberately left out of this pattern.
  /^\/api\/analytics\/activity(?!\/export)/,
  /^\/api\/auth\/(check-email|organization-by-domain|me)/,
];

// A 401 is almost always a browser tab holding a token that expired overnight.
// It says nothing about intent, and logging it would drown the real failures.
const IGNORED_FAILURE_CODES = new Set([401]);

function cleanPath(req) {
  return String(req.originalUrl || req.url || '').split('?')[0];
}

// "POST /api/organizations/members/:id/role" - the pattern, not the filled-in
// path, so every call to one endpoint groups under one key.
function routeKey(req) {
  if (!req.route) return null;
  return `${req.method} ${req.baseUrl || ''}${req.route.path === '/' ? '' : req.route.path}`;
}

// Anything that writes and has no rule of its own still gets recorded, named
// after the resource it touched: POST /api/widgets -> "widgets.create".
function fallbackRule(req) {
  if (req.method === 'GET') return null;

  const segments = cleanPath(req).split('/').filter(Boolean);   // ['api', 'widgets', ...]
  const resource = segments[1] || 'api';
  const verb = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' }[req.method] || 'call';

  return {
    action: `${resource}.${verb}`,
    category: 'other',
    describe: () => ({ description: `${req.method} ${cleanPath(req)}` }),
  };
}

// The route's own params when they survived, otherwise what the URL still
// says. Only the shapes the rules above actually read are reconstructed.
function resolveParams(req, path) {
  const params = { ...(req.params || {}) };

  const ids = path.match(/[a-f\d]{24}/gi) || [];
  if (ids.length) {
    if (!params.id) [params.id] = ids;
    if (!params.companyId) params.companyId = ids[ids.length - 1];
  }

  if (!params.provider) {
    const [, provider] = path.match(/^\/api\/integrations\/([^/]+)/i) || [];
    if (provider) params.provider = provider;
  }

  return params;
}

// Who to attribute the row to. Normally the authenticated seat; for sign-in and
// signup there is no session yet, so the actor comes out of what the route
// answered with, and for a rejected sign-in out of what was typed.
async function resolveActor({ req, body, outcome }) {
  if (req.user) {
    return {
      userId: req.user._id,
      name: person(req.user),
      email: req.user.email,
      role: req.user.role,
      organizationId: req.organization?._id || req.user.organizationId || null,
    };
  }

  // A successful login/register answers with the user and their organization
  if (body?.user?.email) {
    return {
      userId: body.user._id,
      name: person(body.user),
      email: body.user.email,
      role: body.user.role,
      organizationId: body.organization?._id || body.user.organizationId || null,
    };
  }

  // A rejected sign-in: attribute it to the tenant that owns the email domain,
  // so an admin sees attempts against their company even when the address has
  // no seat. An address on an unregistered domain belongs to nobody and is
  // dropped - it is not any organization's activity.
  if (outcome === 'failure' && req.body?.email) {
    const email = String(req.body.email).trim().toLowerCase();
    const domain = domainFromEmail(email);
    if (!domain) return null;

    const [org, user] = await Promise.all([
      Organization.findOne({ domains: domain }).select('_id').lean(),
      User.findOne({ email }).select('_id firstName lastName role organizationId').lean(),
    ]);

    const organizationId = user?.organizationId || org?._id;
    if (!organizationId) return null;

    return {
      userId: user?._id || null,
      name: user ? person(user) : email,
      email,
      role: user?.role || 'unknown',
      organizationId,
    };
  }

  return null;
}

async function capture(req, res, startedAt) {
  const path = cleanPath(req);
  if (IGNORED.some(rx => rx.test(path))) return;

  const rule = RULES[routeKey(req)] || fallbackRule(req);
  if (!rule) return;

  const outcome = res.statusCode >= 400 ? 'failure' : 'success';
  if (outcome === 'failure' && rule.logFailures !== true) {
    if (rule.logFailures === false) return;
    if (IGNORED_FAILURE_CODES.has(res.statusCode)) return;
  }

  // Express restores req.params as it unwinds its router stack, and this runs
  // after the response is already out - so on some paths the route params are
  // gone by now. Rebuilding them from the URL keeps a row from losing the id of
  // the thing it is about. Assigned back onto req so every rule above can read
  // req.params without each of them having to know this happened.
  req.params = resolveParams(req, path);

  const ctx = {
    req,
    res,
    outcome,
    body: res.locals.activityBody,
    preload: req.activityPreload,
  };

  const actor = await resolveActor(ctx);
  // Nothing to attribute it to means nothing an admin could act on. Better an
  // absent row than one filed against the wrong tenant.
  if (!actor?.organizationId) return;

  const detail = (typeof rule.describe === 'function' ? rule.describe(ctx) : null) || {};
  const action = typeof rule.action === 'function' ? rule.action(ctx) : rule.action;

  await ActivityLog.create({
    organizationId: actor.organizationId,
    userId: actor.userId || undefined,
    actor: { name: actor.name, email: actor.email, role: actor.role },
    action,
    category: rule.category || 'other',
    description: detail.description || action,
    target: detail.target
      ? {
          type: detail.target.type,
          id: detail.target.id ? String(detail.target.id) : undefined,
          label: detail.target.label,
        }
      : undefined,
    outcome,
    method: req.method,
    path,
    statusCode: res.statusCode,
    durationMs: Date.now() - startedAt,
    ip: req.ip,
    userAgent: String(req.get('user-agent') || '').slice(0, 300),
    metadata: detail.metadata ? redact(detail.metadata) : undefined,
    createdAt: new Date(),
  });
}

/**
 * Mounted above the whole API.
 *
 * Nothing here is allowed to affect the response. The row is written after the
 * socket has been handed the last byte, and every failure inside it is
 * swallowed: an audit log that can 500 a working request is worse than no
 * audit log at all.
 */
function middleware(req, res, next) {
  const startedAt = Date.now();

  // Route handlers answer with res.json, so this is where the payload can be
  // read without asking sixty handlers to hand it over.
  const sendJson = res.json.bind(res);
  res.json = (payload) => {
    res.locals.activityBody = payload;
    return sendJson(payload);
  };

  res.on('finish', () => {
    capture(req, res, startedAt).catch(error =>
      console.warn('⚠️ Activity log write failed:', error.message)
    );
  });

  const preload = PRELOADS.find(p => p.method === req.method && p.test.test(cleanPath(req)));
  if (!preload) return next();

  const [, id] = cleanPath(req).match(preload.test) || [];
  preload
    .load(id)
    .then((value) => { req.activityPreload = value; })
    .catch(() => {})
    .finally(next);
}

/**
 * Write a row from outside the request cycle - a scheduled job, a webhook, a
 * background sync. Never throws: the caller's real work must not depend on the
 * log succeeding.
 */
async function record({ organization, user, action, category, description, target, metadata, outcome = 'success' }) {
  try {
    const organizationId = organization?._id || organization;
    if (!organizationId || !action) return null;

    return await ActivityLog.create({
      organizationId,
      userId: user?._id,
      actor: user
        ? { name: person(user), email: user.email, role: user.role }
        : { name: 'SalesMotion', email: null, role: 'system' },
      action,
      category: category || 'system',
      description,
      target,
      outcome,
      metadata: metadata ? redact(metadata) : undefined,
      createdAt: new Date(),
    });
  } catch (error) {
    console.warn('⚠️ Activity log write failed:', error.message);
    return null;
  }
}

module.exports = { middleware, record };
