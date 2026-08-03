const express = require('express');
const cors = require('cors');
require('dotenv').config();
const mongoose = require('mongoose');
const { initSupabase, verifySupabase, getSupabase } = require('./config/supabase');

const app = express();

// Middleware
// Restrict CORS to the configured frontend rather than allowing every origin
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow tools with no Origin header (curl, server-to-server, health probes)
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    const err = new Error(`Origin not allowed by CORS: ${origin}`);
    err.status = 403;
    return callback(err);
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB Connection - document store for users, companies, signals, reports
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB connected');
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err.message);
  });

// Supabase - SQL store (replaces the previous SQLite connection)
initSupabase();
verifySupabase();

// Make clients globally accessible
global.db = getSupabase();
global.mongodb = mongoose;

// Routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/organizations', require('./routes/organizations.routes'));
app.use('/api/companies', require('./routes/companies.routes'));
app.use('/api/signals', require('./routes/signals.routes'));
app.use('/api/reports', require('./routes/reports.routes'));
app.use('/api/accounts', require('./routes/accounts.routes'));
app.use('/api/alerts', require('./routes/alerts.routes'));
app.use('/api/inbox', require('./routes/inbox.routes'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'Server is running',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    supabase: getSupabase() ? 'configured' : 'not configured',
  });
});

// Unknown routes - respond with JSON rather than Express' HTML error page
app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({ error: err.message });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on http://localhost:${PORT}`);
  console.log(`🔗 Allowed origins: ${allowedOrigins.join(', ')}\n`);
});

module.exports = app;
