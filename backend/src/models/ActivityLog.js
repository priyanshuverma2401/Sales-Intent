const mongoose = require('mongoose');

// How long an entry survives. A TTL index drops anything older, so the
// collection cannot grow without bound on a busy tenant.
//
// MongoDB will not silently re-point an existing TTL index at a new duration -
// the second createIndex is a no-op - so `ensureRetention` below issues the
// collMod that actually moves it. Without that, changing this value would
// appear to work and quietly keep the old window.
const RETENTION_DAYS = Math.max(1, Number(process.env.ACTIVITY_LOG_RETENTION_DAYS) || 365);
const RETENTION_SECONDS = RETENTION_DAYS * 24 * 60 * 60;

/**
 * One recorded action inside a tenant.
 *
 * The actor is stored twice over: `userId` points at the seat, and `actor`
 * holds a frozen copy of who they were at the time. That duplication is the
 * point - a seat can be deleted, renamed or demoted, and the log still has to
 * say who did the thing and what authority they held when they did it. A log
 * that reads "(deleted user) removed 14 accounts" is not an audit trail.
 */
const activityLogSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
  },

  // Absent only for a failed sign-in against an address that has no account -
  // still worth recording against the organization that owns the domain.
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  actor: {
    name: String,
    email: String,
    role: String,
  },

  // Machine-readable verb: 'report.generate', 'member.remove', 'auth.login'.
  // The prefix is the subject, the suffix the act, so filtering by prefix
  // gives every action against one part of the product.
  action: { type: String, required: true },

  // Coarse grouping the log UI filters on. Kept as a plain string rather than
  // an enum so a new route can start logging without a schema migration.
  category: { type: String, default: 'other' },

  // Written for a human reading the table: "Generated a report for HSBC".
  description: String,

  target: {
    type: { type: String },  // report | account | member | organization | apiKey | ...
    id: String,
    label: String,
  },

  outcome: {
    type: String,
    enum: ['success', 'failure'],
    default: 'success',
  },

  // The request itself. Kept because "who did what" is only half of a
  // discrepancy check - the other half is from where, and whether it worked.
  method: String,
  path: String,
  statusCode: Number,
  durationMs: Number,
  ip: String,
  userAgent: String,

  // Anything action-specific: the fields a profile edit changed, the role a
  // member moved between, the provider a CRM call was for. Redacted upstream -
  // no passwords, tokens or client secrets ever reach this.
  metadata: mongoose.Schema.Types.Mixed,

  createdAt: { type: Date, default: Date.now },
});

// The log is always read newest-first within one tenant, usually narrowed by
// person, verb or category. Each index below serves one of those reads.
activityLogSchema.index({ organizationId: 1, createdAt: -1 });
activityLogSchema.index({ organizationId: 1, userId: 1, createdAt: -1 });
activityLogSchema.index({ organizationId: 1, action: 1, createdAt: -1 });
activityLogSchema.index({ organizationId: 1, category: 1, createdAt: -1 });
activityLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: RETENTION_SECONDS });

const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);

/**
 * Bring the TTL window in line with ACTIVITY_LOG_RETENTION_DAYS.
 *
 * Best-effort by design: a permissions error on collMod (a locked-down Atlas
 * user, say) must not stop the server booting. The log still works, it just
 * keeps entries for whatever window the existing index carries.
 */
ActivityLog.ensureRetention = async function ensureRetention() {
  try {
    const collection = ActivityLog.collection;
    const indexes = await collection.indexes();
    const ttl = indexes.find(i => i.expireAfterSeconds !== undefined && i.key?.createdAt === 1);

    if (!ttl || ttl.expireAfterSeconds === RETENTION_SECONDS) return;

    await collection.conn.db.command({
      collMod: collection.collectionName,
      index: { keyPattern: { createdAt: 1 }, expireAfterSeconds: RETENTION_SECONDS },
    });
    console.log(`✅ Activity log retention set to ${RETENTION_DAYS} days`);
  } catch (error) {
    console.warn('⚠️ Could not update activity log retention:', error.message);
  }
};

ActivityLog.RETENTION_DAYS = RETENTION_DAYS;

module.exports = ActivityLog;
