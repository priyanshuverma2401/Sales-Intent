const express = require('express');
const mongoose = require('mongoose');
const ActivityLog = require('../models/ActivityLog');
const Company = require('../models/Company');
const Report = require('../models/Report');
const Signal = require('../models/Signal');
const User = require('../models/User');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// Everything below is owner/admin only. The overview aggregates work the whole
// desk did and the log names who did it, neither of which is a member's to read.
router.use(authenticate, authorize('owner', 'admin'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Day buckets are UTC. A tenant spread across time zones would otherwise see
// the same action fall on different days depending on who was looking.
const DAY_FORMAT = { format: '%Y-%m-%d', timezone: 'UTC' };

function rangeFrom(query) {
  const days = Math.min(365, Math.max(1, Number(query.days) || 30));
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  from.setUTCHours(0, 0, 0, 0);
  return { days, from, to };
}

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

// Every day in the window, so a quiet Sunday renders as a zero rather than
// disappearing and pulling the line across a gap that never happened.
function emptySeries(from, days) {
  const out = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(from);
    d.setUTCDate(d.getUTCDate() + i);
    out.push(dayKey(d));
  }
  return out;
}

function toMap(rows) {
  return new Map(rows.map(r => [r._id, r.count]));
}

const person = u => `${u?.firstName || ''} ${u?.lastName || ''}`.trim() || u?.email || 'Unknown';

// Reports written before organizationId was stored carry only their author, so
// the tenant's own history is unioned in rather than being invisible here while
// it is still visible on the reports page.
function reportScope(orgId, memberIds) {
  return { $or: [{ organizationId: orgId }, { userId: { $in: memberIds } }] };
}

// Every company anyone on the team is watching. The watchlist is embedded on
// the user, so the set of accounts a tenant owns is a union across its seats.
async function watchedCompanyIds(memberIds) {
  const rows = await User.aggregate([
    { $match: { _id: { $in: memberIds } } },
    { $unwind: '$watchlist' },
    { $group: { _id: '$watchlist.companyId' } },
  ]);
  return rows.map(r => r._id).filter(Boolean);
}

// ---------------------------------------------------------------------------
// GET /api/analytics/overview?days=30
//
// One request behind the whole dashboard. Deliberately one round trip: eight
// separate endpoints would render eight charts that each refreshed at a
// slightly different moment, and the numbers would not add up on screen.
// ---------------------------------------------------------------------------
router.get('/overview', async (req, res) => {
  try {
    const org = req.organization;
    if (!org) return res.status(404).json({ error: 'No organization linked to this account' });

    const { days, from, to } = rangeFrom(req.query);
    const orgId = org._id;

    const members = await User.find({ organizationId: orgId })
      .select('firstName lastName email role lastLogin createdAt')
      .lean();
    const memberIds = members.map(m => m._id);

    const companyIds = await watchedCompanyIds(memberIds);
    const scope = reportScope(orgId, memberIds);
    const inRange = { ...scope, generatedAt: { $gte: from, $lte: to } };

    const [
      reportsByDay,
      accountsByDay,
      signalsByDay,
      activityByDay,
      reportsByStatus,
      scoreBuckets,
      signalsByType,
      activityByCategory,
      topActions,
      reportsByUser,
      actionsByUser,
      accountsByUser,
      topAccounts,
      industries,
      totals,
      recentFailures,
    ] = await Promise.all([
      Report.aggregate([
        { $match: inRange },
        { $group: { _id: { $dateToString: { ...DAY_FORMAT, date: '$generatedAt' } }, count: { $sum: 1 } } },
      ]),

      User.aggregate([
        { $match: { _id: { $in: memberIds } } },
        { $unwind: '$watchlist' },
        { $match: { 'watchlist.addedAt': { $gte: from, $lte: to } } },
        { $group: { _id: { $dateToString: { ...DAY_FORMAT, date: '$watchlist.addedAt' } }, count: { $sum: 1 } } },
      ]),

      Signal.aggregate([
        { $match: { companyId: { $in: companyIds }, createdAt: { $gte: from, $lte: to } } },
        { $group: { _id: { $dateToString: { ...DAY_FORMAT, date: '$createdAt' } }, count: { $sum: 1 } } },
      ]),

      ActivityLog.aggregate([
        { $match: { organizationId: orgId, createdAt: { $gte: from, $lte: to } } },
        { $group: { _id: { $dateToString: { ...DAY_FORMAT, date: '$createdAt' } }, count: { $sum: 1 } } },
      ]),

      Report.aggregate([
        { $match: inRange },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),

      // Fit bands, not raw scores: "eleven accounts scored 80+" is a decision,
      // a histogram of every value is a shrug.
      Report.aggregate([
        { $match: { ...inRange, 'score.value': { $ne: null } } },
        {
          $bucket: {
            groupBy: '$score.value',
            boundaries: [0, 40, 60, 80, 101],
            default: 'unscored',
            output: { count: { $sum: 1 } },
          },
        },
      ]),

      Signal.aggregate([
        { $match: { companyId: { $in: companyIds }, createdAt: { $gte: from, $lte: to } } },
        { $group: { _id: '$type', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      ActivityLog.aggregate([
        { $match: { organizationId: orgId, createdAt: { $gte: from, $lte: to } } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      ActivityLog.aggregate([
        { $match: { organizationId: orgId, createdAt: { $gte: from, $lte: to } } },
        { $group: { _id: '$action', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ]),

      Report.aggregate([
        { $match: inRange },
        {
          $group: {
            _id: '$userId',
            count: { $sum: 1 },
            avgScore: { $avg: '$score.value' },
            completed: { $sum: { $cond: [{ $eq: ['$status', 'complete'] }, 1, 0] } },
          },
        },
      ]),

      ActivityLog.aggregate([
        { $match: { organizationId: orgId, createdAt: { $gte: from, $lte: to } } },
        { $group: { _id: '$userId', count: { $sum: 1 }, lastAt: { $max: '$createdAt' } } },
      ]),

      // How many accounts each seat is carrying - a rep watching nothing and a
      // rep watching two hundred are both worth noticing.
      User.aggregate([
        { $match: { _id: { $in: memberIds } } },
        { $project: { _id: 1, count: { $size: { $ifNull: ['$watchlist', []] } } } },
      ]),

      Report.aggregate([
        { $match: inRange },
        {
          $group: {
            _id: '$companyId',
            name: { $first: '$companyName' },
            reports: { $sum: 1 },
            bestScore: { $max: '$score.value' },
            lastAt: { $max: '$generatedAt' },
          },
        },
        { $sort: { reports: -1, lastAt: -1 } },
        { $limit: 8 },
      ]),

      Company.aggregate([
        { $match: { _id: { $in: companyIds } } },
        { $group: { _id: '$industry', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 6 },
      ]),

      // Current state rather than windowed: how much the tenant holds in total.
      Promise.all([
        Report.countDocuments(scope),
        Report.countDocuments({ ...scope, status: 'pending' }),
        Report.countDocuments({ ...scope, status: 'failed' }),
        Report.distinct('companyId', scope),
      ]),

      // The security line on the dashboard: rejected sign-ins and denied
      // actions. Small number, high signal.
      ActivityLog.countDocuments({
        organizationId: orgId,
        outcome: 'failure',
        createdAt: { $gte: from, $lte: to },
      }),
    ]);

    const [reportsAllTime, reportsPending, reportsFailed, companiesWithReports] = totals;

    // --- Series ------------------------------------------------------------
    const dayList = emptySeries(from, days);
    const reportsMap = toMap(reportsByDay);
    const accountsMap = toMap(accountsByDay);
    const signalsMap = toMap(signalsByDay);
    const activityMap = toMap(activityByDay);

    const series = dayList.map(date => ({
      date,
      reports: reportsMap.get(date) || 0,
      accounts: accountsMap.get(date) || 0,
      signals: signalsMap.get(date) || 0,
      actions: activityMap.get(date) || 0,
    }));

    // --- Per-person ----------------------------------------------------------
    const reportsByUserMap = new Map(reportsByUser.map(r => [String(r._id), r]));
    const actionsByUserMap = new Map(actionsByUser.map(r => [String(r._id), r]));
    const accountsByUserMap = new Map(accountsByUser.map(r => [String(r._id), r.count]));

    const people = members
      .map((member) => {
        const id = String(member._id);
        const reports = reportsByUserMap.get(id);
        const actions = actionsByUserMap.get(id);
        const lastActive = actions?.lastAt || member.lastLogin || null;

        return {
          _id: id,
          name: person(member),
          email: member.email,
          role: member.role,
          accounts: accountsByUserMap.get(id) || 0,
          reports: reports?.count || 0,
          reportsCompleted: reports?.completed || 0,
          avgScore: reports?.avgScore != null ? Math.round(reports.avgScore) : null,
          actions: actions?.count || 0,
          lastActive,
          joinedAt: member.createdAt,
        };
      })
      .sort((a, b) => b.actions - a.actions || b.reports - a.reports);

    const scoreBandLabels = { 0: '0–39', 40: '40–59', 60: '60–79', 80: '80–100' };

    res.json({
      range: { days, from, to },

      kpis: {
        members: members.length,
        // "Active" means they did something in the window, not that they have a
        // seat. A seat nobody uses is exactly what an admin wants to spot.
        activeMembers: people.filter(p => p.actions > 0).length,
        seats: org.subscription?.seats || 0,
        accountsTracked: companyIds.length,
        accountsWithReports: companiesWithReports.length,
        reportsInRange: reportsByDay.reduce((sum, r) => sum + r.count, 0),
        reportsAllTime,
        reportsPending,
        reportsFailed,
        signalsInRange: signalsByDay.reduce((sum, r) => sum + r.count, 0),
        actionsInRange: activityByDay.reduce((sum, r) => sum + r.count, 0),
        failedActions: recentFailures,
      },

      series,

      breakdown: {
        reportStatus: ['complete', 'pending', 'failed'].map(status => ({
          status,
          count: reportsByStatus.find(r => r._id === status)?.count || 0,
        })),
        scoreBands: [0, 40, 60, 80].map(boundary => ({
          band: scoreBandLabels[boundary],
          count: scoreBuckets.find(b => b._id === boundary)?.count || 0,
        })),
        signalTypes: signalsByType.slice(0, 8).map(s => ({ type: s._id || 'other', count: s.count })),
        activityCategories: activityByCategory.map(c => ({ category: c._id || 'other', count: c.count })),
        topActions: topActions.map(a => ({ action: a._id, count: a.count })),
        industries: industries.map(i => ({ industry: i._id || 'Unknown', count: i.count })),
      },

      people,

      topAccounts: topAccounts.map(a => ({
        _id: a._id,
        name: a.name || 'Unknown',
        reports: a.reports,
        bestScore: a.bestScore ?? null,
        lastAt: a.lastAt,
      })),

      retentionDays: ActivityLog.RETENTION_DAYS,
    });
  } catch (error) {
    console.error('Analytics overview error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// The activity log
// ---------------------------------------------------------------------------

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Filtering happens here rather than in the browser so it covers the whole
// retained history, not the page the client happens to be holding.
function logQuery(req) {
  const query = { organizationId: req.organization._id };

  if (req.query.userId && mongoose.isValidObjectId(req.query.userId)) {
    query.userId = new mongoose.Types.ObjectId(req.query.userId);
  }
  if (req.query.category && req.query.category !== 'all') {
    query.category = String(req.query.category);
  }
  if (req.query.action && req.query.action !== 'all') {
    query.action = String(req.query.action);
  }
  if (req.query.outcome === 'success' || req.query.outcome === 'failure') {
    query.outcome = req.query.outcome;
  }

  const from = req.query.from ? new Date(req.query.from) : null;
  const to = req.query.to ? new Date(req.query.to) : null;
  if ((from && !Number.isNaN(from.valueOf())) || (to && !Number.isNaN(to.valueOf()))) {
    query.createdAt = {};
    if (from && !Number.isNaN(from.valueOf())) query.createdAt.$gte = from;
    if (to && !Number.isNaN(to.valueOf())) {
      // An end date means the end of that day, not midnight at the start of it
      to.setUTCHours(23, 59, 59, 999);
      query.createdAt.$lte = to;
    }
  }

  const q = String(req.query.q || '').trim();
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    query.$or = [
      { description: rx },
      { 'actor.name': rx },
      { 'actor.email': rx },
      { 'target.label': rx },
      { action: rx },
      { ip: rx },
    ];
  }

  return query;
}

// GET /api/analytics/activity?page=1&limit=50&userId=&category=&action=&outcome=&q=&from=&to=
router.get('/activity', async (req, res) => {
  try {
    if (!req.organization) return res.status(404).json({ error: 'No organization linked to this account' });

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const query = logQuery(req);

    const [entries, total] = await Promise.all([
      ActivityLog.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      ActivityLog.countDocuments(query),
    ]);

    res.set('X-Total-Count', String(total));
    res.json({ entries, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (error) {
    console.error('Activity log error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Options for the log's filter row, derived from what the tenant has actually
// done - an empty dropdown is better than one listing verbs nobody has used.
router.get('/filters', async (req, res) => {
  try {
    if (!req.organization) return res.json({ actions: [], categories: [], members: [] });

    const orgId = req.organization._id;
    const [actions, categories, members] = await Promise.all([
      ActivityLog.distinct('action', { organizationId: orgId }),
      ActivityLog.distinct('category', { organizationId: orgId }),
      User.find({ organizationId: orgId }).select('firstName lastName email role').sort({ firstName: 1 }).lean(),
    ]);

    res.json({
      actions: actions.filter(Boolean).sort(),
      categories: categories.filter(Boolean).sort(),
      members: members.map(m => ({ _id: m._id, name: person(m), email: m.email, role: m.role })),
      retentionDays: ActivityLog.RETENTION_DAYS,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// A CSV of exactly what the filters currently select. Entries expire after the
// retention window, so this is how an admin keeps anything longer.
const CSV_LIMIT = 20000;

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  // Leading =, +, - or @ makes a spreadsheet treat the cell as a formula
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

router.get('/activity/export', async (req, res) => {
  try {
    if (!req.organization) return res.status(404).json({ error: 'No organization linked to this account' });

    const entries = await ActivityLog.find(logQuery(req))
      .sort({ createdAt: -1 })
      .limit(CSV_LIMIT)
      .lean();

    const header = [
      'When (UTC)', 'Person', 'Email', 'Role', 'Action', 'Category',
      'What happened', 'Target', 'Outcome', 'Status', 'IP address', 'Browser',
    ];

    const rows = entries.map(e => [
      e.createdAt, e.actor?.name, e.actor?.email, e.actor?.role, e.action, e.category,
      e.description, e.target?.label || e.target?.id, e.outcome, e.statusCode, e.ip, e.userAgent,
    ]);

    const csv = [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
    const stamp = new Date().toISOString().slice(0, 10);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="activity-log-${stamp}.csv"`);
    // Excel reads a bare UTF-8 CSV as the system codepage and mangles any
    // non-ASCII name in it; the BOM is what stops that.
    res.send(`﻿${csv}`);
  } catch (error) {
    console.error('Activity export error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
