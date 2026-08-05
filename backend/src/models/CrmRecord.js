const mongoose = require('mongoose');

// The tenant's own view of a prospect, pulled from their CRM and normalised so
// Salesforce and Zoho are indistinguishable downstream.
//
// It is cached rather than fetched live on every report: a report run would
// otherwise make four CRM calls while the AI is already waiting, and the diff
// between the previous snapshot and the new one is what produces CRM signals.

const opportunitySchema = new mongoose.Schema({
  externalId: String,
  name: String,
  stage: String,
  amount: Number,
  currency: String,
  closeDate: Date,
  probability: Number,
  nextStep: String,
  owner: String,
  isClosed: Boolean,
  isWon: Boolean,
  updatedAt: Date,
}, { _id: false });

const contactSchema = new mongoose.Schema({
  externalId: String,
  name: String,
  title: String,
  email: String,
  department: String,
}, { _id: false });

const activitySchema = new mongoose.Schema({
  externalId: String,
  subject: String,
  kind: String,     // task | event | note | call
  status: String,
  occurredAt: Date,
  who: String,
  summary: String,
}, { _id: false });

const crmRecordSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true,
  },
  companyName: String,

  provider: { type: String, enum: ['salesforce', 'zoho'] },

  // False when the CRM has no account by that name - cached too, so a miss does
  // not re-query the CRM on every report.
  matched: { type: Boolean, default: false },

  account: {
    externalId: String,
    name: String,
    owner: String,
    type: String,
    rating: String,
    industry: String,
    website: String,
    annualRevenue: Number,
    employees: Number,
    description: String,
    lastActivityAt: Date,
    url: String,
  },

  opportunities: [opportunitySchema],
  contacts: [contactSchema],
  activities: [activitySchema],

  fetchedAt: { type: Date, default: Date.now },
  error: String,
});

crmRecordSchema.index({ organizationId: 1, companyId: 1 }, { unique: true });

// Everything a prompt or a score needs, with the noise dropped
crmRecordSchema.methods.toContext = function () {
  const open = (this.opportunities || []).filter(o => !o.isClosed);
  const won = (this.opportunities || []).filter(o => o.isWon);

  return {
    provider: this.provider,
    matched: this.matched,
    fetchedAt: this.fetchedAt,
    account: this.account || null,
    openPipeline: open.reduce((total, o) => total + (o.amount || 0), 0),
    openOpportunities: open,
    wonOpportunities: won,
    opportunityCount: (this.opportunities || []).length,
    contacts: this.contacts || [],
    activities: this.activities || [],
    lastActivityAt:
      this.account?.lastActivityAt ||
      (this.activities || []).map(a => a.occurredAt).filter(Boolean).sort((a, b) => b - a)[0] ||
      null,
  };
};

module.exports = mongoose.model('CrmRecord', crmRecordSchema);
