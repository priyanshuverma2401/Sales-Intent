const mongoose = require('mongoose');

// An inbound lead captured from the login screen: someone tried to sign in with
// a work email whose domain no company has registered yet. Nothing here is
// authenticated - it is a follow-up queue for the sales team, kept separate from
// User/Organization so a lead can never be mistaken for a provisioned account.
const demoRequestSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    index: true,
  },

  // The whole point of the extra field on the form - this is how we follow up.
  phone: {
    type: String,
    required: true,
    trim: true,
  },

  // Derived from the email so the pipeline can be grouped by prospect company
  // even when nobody typed a company name.
  domain: {
    type: String,
    trim: true,
    lowercase: true,
    index: true,
  },
  companyName: { type: String, trim: true },
  fullName: { type: String, trim: true },

  status: {
    type: String,
    enum: ['new', 'contacted', 'qualified', 'converted', 'dropped'],
    default: 'new',
    index: true,
  },

  // Where the lead came in from, so the same collection can serve a marketing
  // site form later without guessing at its origin.
  source: { type: String, default: 'login_page' },

  // Free-text for whoever picks the lead up
  notes: String,

  // How many times this person asked. Repeat submissions update the existing
  // document rather than filling the queue with duplicates of the same lead.
  requestCount: { type: Number, default: 1 },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

demoRequestSchema.index({ createdAt: -1 });

demoRequestSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('DemoRequest', demoRequestSchema);
