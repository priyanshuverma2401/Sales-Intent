const mongoose = require('mongoose');

// One CRM per tenant per provider. Holds the OAuth material needed to mint an
// access token on demand, the sync switches an admin controls, and the health
// of the last run.
//
// Secrets are stored encrypted (see services/crm/secrets.js) and never leave the
// server: toJSON strips them, so an accidental res.json(connection) is safe.

const secretSchema = new mongoose.Schema(
  { iv: String, tag: String, data: String },
  { _id: false }
);

const crmConnectionSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  },

  provider: {
    type: String,
    enum: ['salesforce', 'zoho'],
    required: true,
  },

  status: {
    type: String,
    enum: ['connected', 'error', 'disconnected'],
    default: 'connected',
  },

  // Non-secret connection details, safe to show an admin
  loginUrl: String,      // salesforce: https://login.salesforce.com or a My Domain
  instanceUrl: String,   // salesforce: resolved at token time
  apiDomain: String,     // zoho: https://www.zohoapis.com / .eu / .in
  accountsUrl: String,   // zoho: https://accounts.zoho.com / .eu / .in
  clientId: String,
  connectedAccount: String, // the CRM user or org the token belongs to

  clientSecret: secretSchema,
  refreshToken: secretSchema,

  // What the CRM is allowed to influence. All on by default - an admin who
  // connected a CRM wants it used - but each can be turned off independently.
  usage: {
    reports: { type: Boolean, default: true },
    signals: { type: Boolean, default: true },
    score: { type: Boolean, default: true },
  },

  // A snapshot older than this is refreshed the next time a report needs it
  freshnessHours: { type: Number, default: 24 },

  lastSyncAt: Date,
  lastSyncStatus: { type: String, enum: ['ok', 'partial', 'failed'] },
  lastSyncError: String,
  lastSyncCounts: {
    accountsMatched: Number,
    accountsMissing: Number,
    opportunities: Number,
    contacts: Number,
    activities: Number,
    signalsCreated: Number,
  },

  connectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  connectedByName: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

crmConnectionSchema.index({ organizationId: 1, provider: 1 }, { unique: true });

crmConnectionSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

crmConnectionSchema.methods.toJSON = function () {
  const doc = this.toObject();
  delete doc.clientSecret;
  delete doc.refreshToken;
  // The client ID is not a secret, but there is no reason to ship all of it
  if (doc.clientId) doc.clientId = `${String(doc.clientId).slice(0, 8)}…`;
  return doc;
};

module.exports = mongoose.model('CrmConnection', crmConnectionSchema);
