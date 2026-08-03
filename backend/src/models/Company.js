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

  // Financial Data
  financials: {
    marketCap: Number,
    revenue: Number,
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
