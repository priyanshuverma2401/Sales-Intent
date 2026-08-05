const mongoose = require('mongoose');

const signalSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
  },
  companyName: String,
  ticker: String,

  // Signals derived from public sources are shared by every tenant watching the
  // company. Signals derived from a tenant's own CRM are not: they carry the
  // owning organization and are only ever served back to it.
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    index: true,
  },

  // Stable identity for a CRM-derived signal ("this deal moved to this stage"),
  // so a re-sync updates the existing row instead of duplicating it.
  crmKey: { type: String, index: true, sparse: true },

  // Signal Details
  type: {
    type: String,
    enum: [
      'earnings',
      'news',
      'hiring',
      'executive',
      'funding',
      'ma',
      'product',
      'regulation',
      'partnership',
      'documents',
      'podcasts',
      'crm',
    ],
    required: true,
  },
  category: String,
  title: String,
  description: String,
  source: String, // Where the signal came from (NewsAPI, SEC EDGAR, etc.)
  sourceUrl: String,
  confidence: {
    type: Number,
    min: 0,
    max: 100,
  },

  // Content
  content: String,
  tags: [String],

  // Priority & Status
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium',
  },
  isRead: {
    type: Boolean,
    default: false,
  },

  // AI Analysis
  aiAnalysis: {
    summary: String,
    impact: String,
    opportunities: [String],
    risks: [String],
    generatedAt: Date,
  },

  // Metadata
  detectedAt: {
    type: Date,
    default: Date.now,
  },
  publishedAt: Date,
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Index for faster queries
signalSchema.index({ companyId: 1, createdAt: -1 });
signalSchema.index({ type: 1 });
signalSchema.index({ priority: 1 });

module.exports = mongoose.model('Signal', signalSchema);
