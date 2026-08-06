const mongoose = require('mongoose');

// Every narrative line in the report is a claim plus the sources that back it,
// so the UI and the PDF can render footnote markers the way the sample decks do.
const insightSchema = new mongoose.Schema({
  text: String,
  citations: [Number],
}, { _id: false });

const reportSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
  },
  companyName: String,
  ticker: String,

  // Reports are personal: the same prospect produces a different report for a
  // different seller, because the lens changes.
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },

  // Frozen copy of the lens used, so an old report still explains itself after
  // the seller edits their profile.
  context: {
    sellerName: String,
    sellerCapabilities: [String],
    sellerValuePropositions: [String],
    vertical: String,
    verticalCapabilities: [String],
    keywords: [String],
    targetDepartments: [String],
  },

  score: {
    value: Number,
    band: String,
    summary: String,
    reasons: [String],
    breakdown: {
      keywordFit: Number,
      buyingSignals: Number,
      hiringSignals: Number,
      newsMomentum: Number,
      financialContext: Number,
      // Only present when the tenant had a CRM connected at generation time
      crmSignals: Number,
    },
  },

  fastFacts: {
    description: String,
    industry: String,
    headquarters: String,
    employees: Number,
    founded: Number,
    website: String,
    ticker: String,
    marketCap: Number,
    fiscalYearStart: String,
    logoUrl: String,
  },

  quickLinks: [{ label: String, url: String }],

  // --- Page group 1: "What You Need To Know" -------------------------------
  executiveBrief: {
    keyInsights: [insightSchema],
    opportunities: [insightSchema],
    challenges: [insightSchema],
    peopleUpdates: [insightSchema],
    talkingPoints: [insightSchema],
    topNews: [{
      title: String,
      summary: String,
      source: String,
      url: String,
      publishedAt: Date,
      citations: [Number],
    }],
    executivePerspective: [{
      quote: String,
      person: String,
      title: String,
      source: String,
      citations: [Number],
    }],
  },

  // --- Page group 2: "Research & Analysis" ---------------------------------
  research: {
    companyOverview: [insightSchema],
    keyPeopleChanges: [insightSchema],
    keyProjects: [insightSchema],
    aspirations: [insightSchema],
    businessGoals: [insightSchema],
    opportunities: [insightSchema],
    macroPerspective: [insightSchema],
    recentPress: [insightSchema],
    businessModel: {
      revenueStreams: [insightSchema],
      goToMarket: [insightSchema],
      idealCustomerProfile: [insightSchema],
    },
    strategicInitiatives: [insightSchema],
    financials: [insightSchema],
    swot: {
      strengths: [insightSchema],
      weaknesses: [insightSchema],
      opportunities: [insightSchema],
      threats: [insightSchema],
    },
  },

  // --- Page group 3: "Value" -----------------------------------------------
  value: {
    whyChange: [insightSchema],
    whyNow: [insightSchema],
    whyYou: [insightSchema],
    valuePyramid: {
      companyGoals: [insightSchema],
      businessStrategy: [insightSchema],
      challengesObstacles: [insightSchema],
      valuePaths: [insightSchema],
    },
    valuePropositions: [{
      title: String,
      body: String,
      citations: [Number],
    }],
    hypotheses: [insightSchema],
    pointOfView: [insightSchema],
  },

  // Numbered source list the citations point at.
  // `type` must be declared as a nested object: a bare `type: String` key makes
  // Mongoose read the whole element as a type declaration, which silently turns
  // this into an array of strings.
  sources: [{
    index: Number,
    title: String,
    url: String,
    source: String,
    publishedAt: Date,
    type: { type: String }, // news | job | filing | financial | profile
  }],

  // Generated PDF on disk, so downloads serve the stored file instead of
  // re-running the whole fetch + AI pipeline on every request
  pdfPath: String,
  pdfFileName: String,

  status: {
    type: String,
    enum: ['pending', 'complete', 'failed'],
    default: 'pending',
  },
  progress: {
    step: String,
    percent: { type: Number, default: 0 },
  },
  error: String,

  // Nothing assigns this - the provider that actually served the report is
  // recorded on aiModel as "provider/model". Kept for older documents.
  generatedBy: { type: String, default: 'ai' },
  aiModel: String,
  generatedAt: { type: Date, default: Date.now },
  lastUpdatedAt: Date,
  createdAt: { type: Date, default: Date.now },
});

reportSchema.index({ userId: 1, generatedAt: -1 });

module.exports = mongoose.model('Report', reportSchema);
