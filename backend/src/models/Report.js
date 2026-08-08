const mongoose = require('mongoose');

// Every narrative line in the report is a claim plus the sources that back it,
// so the UI and the PDF can render footnote markers the way the sample decks do.
const insightSchema = new mongoose.Schema({
  text: String,
  citations: [Number],
}, { _id: false });

// A talking point is read mid-conversation, so it carries the spoken body plus
// the three things a rep needs next: what to ask, what to prove it with, and
// what to say when it is pushed back on. Only `text` is guaranteed - reports
// written before this shape existed hold nothing else.
const talkingPointSchema = new mongoose.Schema({
  headline: String,
  text: String,
  question: String,
  proof: String,
  objection: String,
  citations: [Number],
}, { _id: false });

// ---------------------------------------------------------------------------
// Verified evidence records.
//
// Everything below is extracted in code from a primary source and stored as a
// record, not written by the model. That is the whole point: a figure the AI
// composed cannot be trusted in a client-facing brief, so the numbers in the
// report come from here and the model is only told about them.
//
// Each record carries the source it came from. A record that cannot name its
// source, or is missing the field that makes it checkable - a person without a
// date, a program without a name - is dropped upstream rather than stored half
// complete.
// ---------------------------------------------------------------------------

// "Christian Schwarz — Head Markets Analytics & AI (May 2026, ex-Mizuho)"
const executiveMoveSchema = new mongoose.Schema({
  person: String,          // required upstream - no name, no record
  role: String,
  // 'joined' | 'left' | 'promoted'
  movement: { type: String },
  // Where they came from (joins) or went to (exits). Often unknown; optional.
  counterparty: String,
  announcedAt: Date,       // required upstream - no date, no record
  url: String,
  source: String,
  citations: [Number],
}, { _id: false });

// A named company programme: "May 2026 growth plan", "Fit for Growth".
// The highest-value trigger in the report, so it is pinned above everything.
const strategicProgramSchema = new mongoose.Schema({
  name: String,            // the company's own name for it - never invented
  announcedAt: Date,
  // "15% RoTE by 2028", "$1.5B savings", "7,000 roles"
  headlineNumber: String,
  summary: String,
  url: String,
  source: String,
  citations: [Number],
}, { _id: false });

// Regulatory action - only populated for accounts tagged as regulated
const regulatoryActionSchema = new mongoose.Schema({
  regulator: String,
  // advisory | fine | deadline | stress-test | licence | enforcement
  actionType: { type: String },
  announcedAt: Date,
  detail: String,
  // The penalty or threshold as the source wrote it - "£57m", "15% buffer".
  // A string, not a number: the unit and the currency are part of the fact.
  amount: String,
  url: String,
  source: String,
  citations: [Number],
}, { _id: false });

const patentSchema = new mongoose.Schema({
  title: String,
  applicant: String,       // exact match only - subsidiaries are never assumed
  filedAt: Date,
  grantedAt: Date,
  // filed | granted
  status: { type: String },
  patentNumber: String,
  url: String,
  citations: [Number],
}, { _id: false });

const contractAwardSchema = new mongoose.Schema({
  awardId: String,
  recipient: String,
  agency: String,
  amount: Number,
  startedAt: Date,
  endedAt: Date,
  awardType: String,
  description: String,
  url: String,
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

  // Frozen copy of the company profile the report was written from, so an old
  // report still explains itself after an admin edits that profile.
  context: {
    sellerName: String,
    sellerCapabilities: [String],
    sellerValuePropositions: [String],
    // The monitored topics, split by the priority they carried at the time
    priorityTopics: [String],
    topics: [String],
    technologies: [String],
    targetIndustries: [String],
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
    revenue: Number,
    revenueCurrency: String,
    revenueAsOf: Number,
    fiscalYearStart: String,
    logoUrl: String,
  },

  quickLinks: [{ label: String, url: String }],

  // --- Verified evidence, extracted in code --------------------------------
  //
  // Rendered directly by the PDF and the web report. The AI passes are told
  // these exist and must lead with them, but never author the figures.
  evidence: {
    executiveMoves: [executiveMoveSchema],
    strategicPrograms: [strategicProgramSchema],
    regulatoryActions: [regulatoryActionSchema],
    patents: [patentSchema],
    contractAwards: [contractAwardSchema],

    // The one-line hiring read: "121 open roles across trade operations and
    // compliance, concentrated in Bangkok and Dubai". Absent when no careers
    // URL is set or the board returned nothing - never estimated.
    hiring: {
      totalRoles: Number,
      // [{ function: 'compliance', count: 14 }] - ops|compliance|tech|finance|sales|hr|other
      byFunction: [{ name: String, count: Number }],
      byLocation: [{ name: String, count: Number }],
      summary: String,
      source: String,
      citations: [Number],
    },

    // "H1 2026: $4.8B profit, up 10%, $1B buyback announced". Every figure
    // carries the source it was read from; a missing figure is simply absent.
    //
    // The numeric fields come from SEC XBRL, where each is the value the
    // company filed for the period. `buyback` and `dividend` are the string
    // fallbacks read off an investor-relations page for companies EDGAR does
    // not cover - kept separate from the filed numbers so the two can never be
    // confused for one another.
    latestResults: {
      period: String,        // "Q2 2026" / "H1 2026" / "FY2025"
      periodEndedAt: Date,
      revenue: Number,
      profit: Number,
      eps: Number,
      buybackAmount: Number,
      dividendPerShare: Number,
      dividend: String,
      buyback: String,
      currency: String,
      // When the filing was made, and when the company last reported. Distinct:
      // a 10-Q is filed days after the call it discusses.
      filedAt: Date,
      lastEarningsAt: Date,
      epsActual: Number,
      epsEstimate: Number,
      summary: String,
      url: String,
      source: String,
      citations: [Number],
    },
  },

  // How much evidence this report was actually written from. Under the floor
  // the report still generates, but says so on its face rather than quietly
  // reading as though it were well sourced.
  coverage: {
    sourceCount: Number,
    uniqueDomains: Number,
    articlesFetched: Number,
    duplicatesDropped: Number,
    thin: { type: Boolean, default: false },
    warning: String,
  },

  // --- Page group 1: "What You Need To Know" -------------------------------
  executiveBrief: {
    keyInsights: [insightSchema],
    opportunities: [insightSchema],
    challenges: [insightSchema],
    peopleUpdates: [insightSchema],
    talkingPoints: [talkingPointSchema],
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

  // --- Whitespace Identification -------------------------------------------
  //
  // Where the account is investing before it has announced anything. Patents
  // and federal awards are dated public record rather than press spin, so they
  // read as R&D direction months ahead of the programme they belong to.
  //
  // The narrative is AI-written against those records; the records themselves
  // live on `evidence` and are rendered from there.
  whitespace: {
    insights: [insightSchema],
    // What the patent and contract activity implies the account will need next
    capabilityGaps: [insightSchema],
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
    type: { type: String }, // news | job | filing | financial | patent | contract | profile
    // Why this source is in the report, from a fixed vocabulary - see
    // intelligenceService.CITATION_REASONS. Shown against the entry in the
    // reference list and on hovering a [n] chip, so a reader can tell at a
    // glance whether a claim rests on an earnings filing or a press mention.
    reason: { type: String },
    // Set when the source was kept over a near-identical syndicated copy, so
    // the reference list can say which publisher the story actually broke on.
    originalPublisher: String,
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
  // When the prospect was first added to the workspace, copied off the company
  // at generation time. Distinct from generatedAt: regenerating writes a new
  // report, but the account has been on the books since whenever it was added.
  accountAddedAt: Date,
  createdAt: { type: Date, default: Date.now },
});

reportSchema.index({ userId: 1, generatedAt: -1 });

module.exports = mongoose.model('Report', reportSchema);
