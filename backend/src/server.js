const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Checked before anything else connects or listens: a missing JWT_SECRET or
// MONGODB_URI is fatal, and failing here prints why instead of surfacing as
// mystery 401s and 500s after the deploy goes live.
const { validateEnv } = require('./config/env');
validateEnv();

const mongoose = require('mongoose');
const { initSupabase, verifySupabase, getSupabase } = require('./config/supabase');
const aiProviders = require('./services/providers');
const reportSweeper = require('./services/reportSweeper');

const app = express();

// Render terminates TLS at its edge and forwards to this process, so the direct
// socket address is Render's proxy, not the visitor. Without this every client
// would share a single rate-limit bucket and one busy user could lock out all
// the others. `1` = trust exactly one proxy hop, which is what Render provides.
app.set('trust proxy', 1);

// ---------------------------------------------------------------------------
// Security & transport
// ---------------------------------------------------------------------------
// Standard hardening headers. contentSecurityPolicy is off because this process
// serves only JSON — the CSP that matters belongs to the frontend on Cloudflare,
// and leaving it on here just adds headers no API client reads.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// Report payloads are large JSON documents; gzip cuts them substantially.
app.use(compression());

// Restrict CORS to the configured frontend rather than allowing every origin.
// Cloudflare Pages gives each preview build its own subdomain, so an entry may
// be written as https://*.project.pages.dev to cover them without opening up
// the whole internet. Exact origins are still matched exactly.
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map(o => o.trim().replace(/\/$/, ''))
  .filter(Boolean);

function originAllowed(origin) {
  return allowedOrigins.some((pattern) => {
    if (pattern === origin) return true;

    // Wildcard form: https://*.suffix — matches any single-label subdomain of it.
    const star = pattern.indexOf('://*.');
    if (star === -1) return false;

    const scheme = pattern.slice(0, star + 3);
    const suffix = pattern.slice(star + 4);

    return (
      origin.startsWith(scheme) &&
      origin.endsWith(suffix) &&
      origin.length > scheme.length + suffix.length
    );
  });
}

app.use(cors({
  origin: (origin, callback) => {
    // Allow tools with no Origin header (curl, server-to-server, health probes)
    if (!origin || originAllowed(origin)) {
      return callback(null, true);
    }
    const err = new Error(`Origin not allowed by CORS: ${origin}`);
    err.status = 403;
    return callback(err);
  },
  credentials: true,
  // Without this the browser hides the header from JS on a cross-origin call,
  // and the reports list cannot show "8 of 60".
  exposedHeaders: ['X-Total-Count'],
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
// Limits are set well above what real use produces and are env-tunable, so no
// existing behaviour changes. They exist for two specific risks: unthrottled
// password guessing on /auth, and report generation, where each call spends
// real money at Groq/Gemini.
const limiter = (limitPerWindow, windowMs, message) => rateLimit({
  windowMs,
  limit: limitPerWindow,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: message }),
});

const globalLimiter = limiter(
  Number(process.env.RATE_LIMIT_GLOBAL) || 600,
  15 * 60 * 1000,
  'Too many requests. Wait a minute and try again.'
);

const authLimiter = limiter(
  Number(process.env.RATE_LIMIT_AUTH) || 30,
  15 * 60 * 1000,
  'Too many sign-in attempts. Try again in a few minutes.'
);

const reportLimiter = limiter(
  Number(process.env.RATE_LIMIT_REPORTS) || 40,
  60 * 60 * 1000,
  'Report generation limit reached for this hour. Try again shortly.'
);

app.use('/api', globalLimiter);

// ---------------------------------------------------------------------------
// Data stores
// ---------------------------------------------------------------------------
let hasConnectedOnce = false;
const bootedAt = Date.now();

// MongoDB Connection - document store for users, companies, signals, reports
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    hasConnectedOnce = true;
    console.log('✅ MongoDB connected');
    // Clears reports the previous instance was generating when it was replaced.
    reportSweeper.start();
  })
  .catch((err) => {
    // Previously this only logged, leaving the instance serving 500s from every
    // database-backed route. Exiting lets Render replace the instance and makes
    // a bad connection string or a missing Atlas IP allowlist entry obvious.
    console.error('❌ MongoDB connection error:', err.message);
    console.error('   Check MONGODB_URI, and that Render outbound IPs are allowed in Atlas.');
    process.exit(1);
  });

mongoose.connection.on('disconnected', () => console.warn('⚠️ MongoDB disconnected'));
mongoose.connection.on('reconnected', () => console.log('✅ MongoDB reconnected'));

// Supabase - SQL store (replaces the previous SQLite connection)
initSupabase();
verifySupabase();

// Make clients globally accessible
global.db = getSupabase();
global.mongodb = mongoose;

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/api/auth', authLimiter, require('./routes/auth.routes'));
app.use('/api/organizations', require('./routes/organizations.routes'));
app.use('/api/companies', require('./routes/companies.routes'));
app.use('/api/signals', require('./routes/signals.routes'));
app.use('/api/reports', reportLimiter, require('./routes/reports.routes'));
app.use('/api/accounts', require('./routes/accounts.routes'));
app.use('/api/alerts', require('./routes/alerts.routes'));
app.use('/api/inbox', require('./routes/inbox.routes'));

// Health check. Render polls this; a 503 marks the instance unhealthy and gets
// it replaced, which is the point — an instance with no database can still
// answer HTTP but fails every real request, and a flat 200 would hide that.
// The grace window keeps the very first deploy from being failed while the
// initial Atlas handshake is still in progress.
const BOOT_GRACE_MS = 45_000;

app.get('/api/health', (req, res) => {
  const dbUp = mongoose.connection.readyState === 1;
  const starting = !hasConnectedOnce && Date.now() - bootedAt < BOOT_GRACE_MS;
  const healthy = dbUp || starting;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'Server is running' : 'Degraded: database unavailable',
    mongodb: dbUp ? 'connected' : starting ? 'connecting' : 'disconnected',
    supabase: getSupabase() ? 'configured' : 'not configured',
    aiProviders: aiProviders.status(),
    uptimeSeconds: Math.round(process.uptime()),
  });
});

// Unknown routes - respond with JSON rather than Express' HTML error page
app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
});

// Error handling. Internal failures must not leak stack details or driver
// messages to the browser in production; the full error still reaches the logs.
app.use((err, req, res, next) => {
  console.error('Error:', err);

  const status = err.status || 500;
  const isServerFault = status >= 500;
  const hideDetail = isServerFault && process.env.NODE_ENV === 'production';

  res.status(status).json({
    error: hideDetail ? 'Something went wrong on our end.' : err.message,
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 5000;

// Bind on 0.0.0.0 so Render's proxy can reach the process. The default binds
// only the loopback interface in some container images, which reads as a failed
// deploy with no error.
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`🔗 Allowed origins: ${allowedOrigins.join(', ')}\n`);
});

// Render sends SIGTERM before replacing an instance and waits before killing it.
// Draining here lets in-flight requests finish and closes the database cleanly
// instead of having both cut mid-write. Reports still generating at this point
// cannot be saved — reportSweeper is what recovers those on the next instance.
let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`\n${signal} received — shutting down gracefully…`);
  reportSweeper.stop();

  server.close(async () => {
    try {
      await mongoose.connection.close(false);
      console.log('✅ Closed out connections. Bye.');
    } catch (error) {
      console.error('Error closing MongoDB:', error.message);
    }
    process.exit(0);
  });

  // Backstop: never hang past the platform's grace period holding a slow socket.
  setTimeout(() => {
    console.error('⏱️ Shutdown timed out — forcing exit.');
    process.exit(1);
  }, 15_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
