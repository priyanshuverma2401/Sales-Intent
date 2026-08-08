const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
  },
  ticker: String,
  industry: String,
  sector: String,
  website: String,
  country: String,
  state: String,
  city: String,
  employees: Number,
  foundedYear: Number,
  description: String,
  logoUrl: String,

  // The company's own page on each site, resolved from the identifiers Wikidata
  // states rather than guessed from the name. Quick Links falls back to a search
  // URL only when these are unknown - neither site can be reached by name.
  profiles: {
    linkedin: String,
    crunchbase: String,
  },
  // The entity every firmographic here came from. Stored so a refresh reads the
  // same company back instead of re-running a name search that may land on a
  // different one.
  wikidataId: String,

  // --- First-party pages we read directly -----------------------------------
  //
  // These are facts about the prospect, not one tenant's opinion of it, so they
  // live on the shared company record: whoever fills one in has done the work
  // for every tenant watching the same account.
  //
  // Each is optional. A missing URL means that source contributes nothing - it
  // is never guessed at, because a wrong careers URL yields another company's
  // headcount and a wrong IR URL yields another company's results.
  //
  // Named `pages` rather than `sources` to keep it distinct from Report.sources,
  // which is the numbered citation list a finished report is written against.
  pages: {
    // ATS board or careers page. Workday and iCIMS cannot be reached without
    // the tenant slug this URL carries, so for those two it is the only way in.
    careersUrl: String,
    // Investor relations, for companies Finnhub does not cover well
    investorRelationsUrl: String,
    // Press / newsroom - where senior hires are usually announced first
    pressUrl: String,
    // Discovered from the homepage's <link rel="alternate">, or set by hand
    blogRssUrl: String,
    // Held for the reference list only. Never fetched: both are ToS-sensitive
    // and neither publishes a free API.
    linkedInPeopleUrl: String,
    indeedUrl: String,
  },

  // --- Crawl targeting ------------------------------------------------------
  //
  // Which of the vertical trade-press, regulator, patent and contract crawls
  // run for this account. Derived from `industry` when the account is added and
  // editable afterwards - see services/accountTagging.js.
  //
  // Untagged accounts still get the always-on cross-industry crawl; these only
  // ever add sources, never remove them.
  tags: {
    // travel | shipping | healthcare | insurance | bfsi | itbpm | utilities | null
    vertical: String,
    // Regulated industries: compliance deadlines create budget with a date on it
    regulated: { type: Boolean, default: false },
    // Public-sector exposure, gating the USAspending crawl
    governmentFacing: { type: Boolean, default: false },
    // R&D/IP-heavy, gating the USPTO crawl
    rndHeavy: { type: Boolean, default: false },
    // False once a human has edited them, so a later backfill cannot overwrite
    // a correction with another guess
    autoTagged: { type: Boolean, default: true },
  },

  // Financial Data
  financials: {
    marketCap: Number,
    revenue: Number,
    // Revenue is not always reported in dollars, and the fiscal year it belongs
    // to is part of the fact - "$X" alone is not quotable on a report cover
    revenueCurrency: String,
    revenueAsOf: Number,
    revenueGrowth: Number,
    earnings: Number,
    eps: Number,
    peRatio: Number,
    debtToEquity: Number,
    currentRatio: Number,
    roe: Number,
    secFilings: [{
      type: { type: String },
      date: String,
      url: String,
      accessionNumber: String,
    }],
    lastUpdated: Date,
  },

  // Stock Data
  stock: {
    currentPrice: Number,
    dayHigh: Number,
    dayLow: Number,
    openPrice: Number,
    previousClose: Number,
    fiftyTwoWeekHigh: Number,
    fiftyTwoWeekLow: Number,
    volume: Number,
    marketCap: Number,
    currency: String,
    exchange: String,
    lastUpdated: Date,
  },

  // Contact Info
  contact: {
    phone: String,
    email: String,
    ceo: String,
  },

  // Data Sources
  dataSources: {
    sec: { lastFetched: Date, status: String },
    yahooFinance: { lastFetched: Date, status: String },
    finnhub: { lastFetched: Date, status: String },
    wikipedia: { lastFetched: Date, status: String },
    wikidata: { lastFetched: Date, status: String },
    crunchbase: { lastFetched: Date, status: String },
    // The refresh route writes this; without it, Mongoose silently dropped it
    news: { lastFetched: Date, status: String },
    jobs: { lastFetched: Date, status: String },
  },

  // Metadata
  addedBy: mongoose.Schema.Types.ObjectId,
  addedAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Company', companySchema);
