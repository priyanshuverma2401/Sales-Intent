const mongoose = require('mongoose');

// A tracked title (contact or hiring) plus the keywords that qualify it, e.g.
// "Director" + ["AI", "Automation", "Operations"].
const titleRuleSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    keywords: { type: [String], default: [] },
  },
  { _id: false }
);

// A monitored topic. `high` priority topics are the ones the signal feed lifts
// to the top, which is why they are flagged rather than just ordered.
const topicSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    priority: { type: String, enum: ['normal', 'high'], default: 'normal' },
  },
  { _id: false }
);

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

  // --- Company profile, admin-managed --------------------------------------
  // Monitoring rules: which people, subjects and stacks are worth a signal at a
  // target account. Set once by an owner/admin, used by every seat.
  relevantContactTitles: { type: [titleRuleSchema], default: [] },
  relevantHiringTitles: { type: [titleRuleSchema], default: [] },
  relevantTopics: { type: [topicSchema], default: [] },
  relevantTechnologies: { type: [String], default: [] },

  // The long-form narrative an admin writes once. `description` above is the
  // company overview; these are the rest of the answers a report can quote.
  productFeatures: String,
  problemsSolved: String,
  outcomesDelivered: String,
  competitorsDifferentiation: String,
  caseStudies: String,
  industryTerminology: String,

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

/**
 * The one and only seller lens. Since the employee persona was removed, this is
 * the complete input to a report: every field an admin fills in on the company
 * profile reaches the prompt, the score or both.
 *
 * Topics keep their priority all the way through - a `high` topic is what the
 * report is written around, a `normal` one is context - so the flags are carried
 * here rather than flattened into a bare list of names.
 */
organizationSchema.methods.toSellerContext = function () {
  const topics = (this.relevantTopics || [])
    .filter(t => t?.name)
    .map(t => ({ name: t.name, priority: t.priority === 'high' ? 'high' : 'normal' }));

  const priorityTopics = topics.filter(t => t.priority === 'high').map(t => t.name);
  const standardTopics = topics.filter(t => t.priority !== 'high').map(t => t.name);
  const capabilities = this.capabilities || [];

  return {
    name: this.name,
    website: this.website,
    industry: this.industry,
    headquarters: this.headquarters,
    employeeBand: this.employeeBand,
    description: this.description,

    capabilities,
    capabilityNotes: this.capabilityNotes,
    valuePropositions: this.valuePropositions || [],
    differentiators: this.differentiators || [],
    proofPoints: this.proofPoints || [],
    targetIndustries: this.targetIndustries || [],
    targetDepartments: this.targetDepartments || [],
    targetRoles: this.targetRoles || [],

    productFeatures: this.productFeatures,
    problemsSolved: this.problemsSolved,
    outcomesDelivered: this.outcomesDelivered,
    competitorsDifferentiation: this.competitorsDifferentiation,
    caseStudies: this.caseStudies,
    industryTerminology: this.industryTerminology,

    topics,
    priorityTopics,
    standardTopics,
    relevantTechnologies: this.relevantTechnologies || [],
    // Titles are flattened to "Director (AI, Automation)" so the prompt reads
    // as prose rather than nested JSON.
    relevantContactTitles: flattenTitles(this.relevantContactTitles),
    relevantHiringTitles: flattenTitles(this.relevantHiringTitles),

    // What the whole report is argued around. High-priority topics win; without
    // any, every monitored topic counts; without those, what the company sells.
    focusTerms: priorityTopics.length
      ? priorityTopics
      : standardTopics.length
        ? standardTopics
        : capabilities,
  };
};

function flattenTitles(rules) {
  return (rules || []).map(r =>
    r.keywords?.length ? `${r.title} (${r.keywords.join(', ')})` : r.title
  );
}

module.exports = mongoose.model('Organization', organizationSchema);
