const express = require('express');
const User = require('../models/User');
const Signal = require('../models/Signal');
const Report = require('../models/Report');
const Company = require('../models/Company');
const accountTagging = require('../services/accountTagging');
const jobDataFetcher = require('../services/dataFetchers/jobDataFetcher');
const { authenticate, isManager } = require('../middleware/auth');

const router = express.Router();

// Matches a company against a free-text query. The watchlist is an embedded
// array rather than its own collection, so this is a plain predicate rather
// than a Mongo filter - but the query still arrives as ?q= like every other
// list in the API, and the client never filters locally.
function matchesQuery(company, q) {
  if (!q) return true;
  const needle = q.toLowerCase();

  return [company.name, company.ticker, company.industry, company.country]
    .filter(Boolean)
    .some(field => String(field).toLowerCase().includes(needle));
}

/**
 * Which accounts this request is about.
 *
 * The board is per-seat: adding an account puts it on the adder's list and on
 * nobody else's. That left an owner unable to even see - let alone remove - an
 * account a colleague had put there, so a manager may ask for the whole
 * tenant's book with ?scope=all. Members get their own list whatever they ask
 * for; the scope is a convenience for the people who already run the tenant,
 * not a way to widen anybody's reach.
 *
 * Returns `{ entry, trackedByMe }` pairs rather than bare watchlist entries,
 * because on the team-wide board the row may belong to somebody else.
 */
async function boardEntries(req) {
  const me = req.user._id.toString();
  const orgId = req.organization?._id;
  const wantsTeam = String(req.query.scope || '') === 'all' && isManager(req.user) && orgId;

  if (!wantsTeam) {
    const user = await User.findById(req.user._id).populate('watchlist.companyId');
    return (user.watchlist || [])
      .filter(w => w.companyId)
      .map(entry => ({ entry, trackedByMe: true }));
  }

  const members = await User.find({ organizationId: orgId })
    .select('_id watchlist')
    .populate('watchlist.companyId');

  // One row per account however many colleagues are watching it. The caller's
  // own entry wins where they have one, so the notes on the row stay their own.
  const byCompany = new Map();

  members.forEach((member) => {
    const mine = member._id.toString() === me;

    (member.watchlist || []).filter(w => w.companyId).forEach((entry) => {
      const key = entry.companyId._id.toString();
      const seen = byCompany.get(key);

      if (!seen || (mine && !seen.trackedByMe)) {
        byCompany.set(key, { entry, trackedByMe: mine });
      }
    });
  });

  return [...byCompany.values()];
}

// The caller's accounts, each with its signal count and the state of its most
// recent report - everything the accounts board needs in one call.
//   ?q=hsbc      company name, ticker, industry or country
//   ?scope=all   every account in the tenant (owner/admin only)
router.get('/', authenticate, async (req, res) => {
  try {
    const all = await boardEntries(req);

    const q = String(req.query.q || '').trim();
    const rows = q ? all.filter(r => matchesQuery(r.entry.companyId, q)) : all;

    // Unfiltered size, so the UI can say "1 of 12" without a second request
    res.set('X-Total-Count', String(all.length));

    const companyIds = rows.map(r => r.entry.companyId._id);

    // Reports belong to the tenant, not to the seat: there is one per account,
    // and whoever generated it, it is the report for this row. Scoping this to
    // `userId` was what made a colleague's account look unresearched and sent
    // the next person to press Generate on it - which is how the duplicates got
    // there in the first place. The author's own work is unioned in for reports
    // written before organizationId was stored.
    const reportScope = req.organization?._id
      ? { $or: [{ organizationId: req.organization._id }, { userId: req.user._id }] }
      : { userId: req.user._id };

    const [counts, reports] = await Promise.all([
      Signal.aggregate([
        { $match: { companyId: { $in: companyIds } } },
        { $group: { _id: '$companyId', count: { $sum: 1 } } },
      ]),
      Report.find({ $and: [reportScope, { companyId: { $in: companyIds } }] })
        .select('companyId status progress error score.value score.band generatedAt refresh.status refresh.step refresh.percent')
        .sort({ generatedAt: -1 }),
    ]);

    const countByCompany = new Map(counts.map(c => [c._id.toString(), c.count]));

    // Removing an account now clears it for the whole team, so each row has to
    // say who put it there and whether this viewer is allowed to take it away.
    // Resolved in one query rather than per row.
    const adderIds = [...new Set(
      rows.map(r => r.entry.companyId.addedBy?.toString()).filter(Boolean)
    )];
    const adders = adderIds.length
      ? await User.find({ _id: { $in: adderIds } }).select('firstName lastName email').lean()
      : [];
    const adderById = new Map(adders.map(a => [
      a._id.toString(),
      `${a.firstName || ''} ${a.lastName || ''}`.trim() || a.email,
    ]));

    const manages = isManager(req.user);
    const me = req.user._id.toString();

    // find() is sorted newest-first, so the first hit per company is the latest
    const latestReport = new Map();
    reports.forEach(r => {
      const key = r.companyId.toString();
      if (!latestReport.has(key)) latestReport.set(key, r);
    });

    res.json(rows.map(({ entry, trackedByMe }) => {
      const company = entry.companyId;
      const key = company._id.toString();
      const report = latestReport.get(key);
      const addedBy = company.addedBy?.toString();

      return {
        ...company.toObject(),
        signalCount: countByCompany.get(key) || 0,
        // On the team-wide board this row may be a colleague's, in which case
        // the notes and the date are theirs and not the caller's to edit.
        notes: trackedByMe ? entry.notes : undefined,
        addedAt: entry.addedAt,
        trackedByMe,
        addedByName: addedBy ? adderById.get(addedBy) || null : null,
        addedByMe: Boolean(addedBy && addedBy === me),
        // Accounts stored before `addedBy` was recorded belong to nobody, so
        // anyone may clear them rather than their being stuck here forever.
        canRemove: !addedBy || addedBy === me || manages,
        latestReport: report
          ? {
              _id: report._id,
              status: report.status,
              progress: report.progress,
              error: report.error,
              score: report.score?.value,
              band: report.score?.band,
              generatedAt: report.generatedAt,
              // A finished report being rewritten stays 'complete' and readable,
              // so this is the only thing that tells the board it is working
              refreshing: report.refresh?.status === 'pending',
              refreshProgress:
                report.refresh?.status === 'pending' ? report.refresh.percent : undefined,
            }
          : null,
      };
    }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// A URL only counts if it is one we can actually fetch. A pasted search box or
// a mistyped host would otherwise be recorded as the account's careers page and
// silently return nothing on every report.
function cleanUrl(value) {
  if (value === undefined) return undefined;
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.href;
  } catch (_) {
    return null;
  }
}

const URL_FIELDS = [
  'careersUrl', 'investorRelationsUrl', 'pressUrl', 'blogRssUrl',
  'linkedInPeopleUrl', 'indeedUrl',
];

const FLAG_FIELDS = ['regulated', 'governmentFacing', 'rndHeavy'];

/**
 * Personal notes, plus the account settings that steer what gets crawled.
 *
 * The URLs and tags live on the shared Company record rather than on the
 * watchlist entry: they are facts about the prospect, not one tenant's opinion
 * of it, so whoever fills one in has done the work for every tenant watching
 * the same account. Notes stay personal.
 */
router.patch('/:companyId', authenticate, async (req, res) => {
  try {
    const entry = (req.user.watchlist || []).find(
      w => w.companyId?.toString() === req.params.companyId
    );

    // A manager may be working from the team-wide board, where the account sits
    // on a colleague's list rather than their own. Everything below except the
    // notes lives on the shared Company record, so there is nothing stopping
    // them editing it; the notes are personal and simply have nowhere to go.
    if (!entry && !isManager(req.user)) {
      return res.status(404).json({ error: 'Account not in your list' });
    }

    if (entry && req.body.notes !== undefined) {
      entry.notes = req.body.notes;
      await req.user.save();
    }

    const { pages, tags } = req.body;
    if (!pages && !tags) {
      return res.json({ message: 'Account updated', notes: entry?.notes });
    }

    const company = await Company.findById(req.params.companyId);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    if (pages) {
      company.pages = company.pages || {};

      for (const field of URL_FIELDS) {
        if (pages[field] === undefined) continue;

        const value = cleanUrl(pages[field]);
        if (value === null) {
          return res.status(400).json({ error: `${field} is not a valid URL` });
        }
        company.pages[field] = value || undefined;
      }

      // The careers URL is what makes Workday and iCIMS reachable at all, so a
      // board we cannot read is worth saying out loud rather than discovering
      // as an empty hiring line three reports later
      if (pages.careersUrl && company.pages.careersUrl) {
        const detected = jobDataFetcher.detectBoard(company.pages.careersUrl);
        if (detected) {
          console.log(`💼 ${company.name}: careers URL resolves to ${detected.board}`);
        }
      }
    }

    if (tags) {
      company.tags = company.tags || {};

      if (tags.vertical !== undefined) {
        const value = String(tags.vertical || '').trim();
        if (value && !accountTagging.VERTICALS[value]) {
          return res.status(400).json({ error: `Unknown vertical "${value}"` });
        }
        company.tags.vertical = value || undefined;
      }

      for (const flag of FLAG_FIELDS) {
        if (tags[flag] !== undefined) company.tags[flag] = Boolean(tags[flag]);
      }

      // A human has answered, so the auto-tagger must not overwrite it later
      company.tags.autoTagged = false;
    }

    company.updatedAt = new Date();
    await company.save();

    res.json({
      message: 'Account updated',
      notes: entry.notes,
      pages: company.pages,
      tags: company.tags,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// The verticals the settings form offers, so the client never hard-codes a list
// that can drift from the one the crawler actually understands
router.get('/meta/verticals', authenticate, (req, res) => {
  res.json(
    Object.entries(accountTagging.VERTICALS).map(([value, spec]) => ({
      value,
      label: spec.label,
      regulated: accountTagging.REGULATED_VERTICALS.has(value),
    }))
  );
});

module.exports = router;
