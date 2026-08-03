const mongoose = require('mongoose');

// A subscribing customer. One Organization owns many employee Users, and every
// account/report those users create is scoped to it. The capability fields are
// the seller-side half of the report prompt: what this company can actually
// offer a prospect.
const organizationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },

  // Email domains that entitle an employee to self-serve a seat.
  // Stored lowercase and unique so signup can resolve an org from an address.
  domains: {
    type: [String],
    required: true,
    index: true,
  },

  website: String,
  industry: String,
  headquarters: String,
  employeeBand: String,

  // What the company does, in its own words - grounds every generated report
  description: String,

  // The seller's offer. Names are short and tag-like; the notes field carries
  // the nuance the tags cannot.
  capabilities: [String],
  capabilityNotes: String,
  valuePropositions: [String],
  differentiators: [String],
  proofPoints: [String],

  // Default prospect targeting, inherited by new employees as a starting point
  targetIndustries: [String],
  targetDepartments: [String],
  targetRoles: [String],

  subscription: {
    plan: { type: String, enum: ['trial', 'starter', 'growth', 'enterprise'], default: 'trial' },
    seats: { type: Number, default: 10 },
    status: { type: String, enum: ['active', 'past_due', 'cancelled'], default: 'active' },
    startedAt: { type: Date, default: Date.now },
    renewsAt: Date,
  },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

organizationSchema.index({ domains: 1 }, { unique: true, sparse: true });

// Normalise domains on every write so lookups can assume lowercase, bare hosts
organizationSchema.pre('save', function (next) {
  if (Array.isArray(this.domains)) {
    this.domains = Array.from(
      new Set(
        this.domains
          .map(d => String(d).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0])
          .filter(Boolean)
      )
    );
  }
  this.updatedAt = new Date();
  next();
});

// The seller context handed to the AI engine for every report
organizationSchema.methods.toSellerContext = function () {
  return {
    name: this.name,
    industry: this.industry,
    description: this.description,
    capabilities: this.capabilities || [],
    capabilityNotes: this.capabilityNotes,
    valuePropositions: this.valuePropositions || [],
    differentiators: this.differentiators || [],
    proofPoints: this.proofPoints || [],
    targetIndustries: this.targetIndustries || [],
    targetDepartments: this.targetDepartments || [],
    targetRoles: this.targetRoles || [],
  };
};

module.exports = mongoose.model('Organization', organizationSchema);
