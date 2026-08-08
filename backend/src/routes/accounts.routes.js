const express = require('express');
const User = require('../models/User');
const Signal = require('../models/Signal');
const Report = require('../models/Report');
const Company = require('../models/Company');
const accountTagging = require('../services/accountTagging');
const jobDataFetcher = require('../services/dataFetchers/jobDataFetcher');
const { authenticate } = require('../middleware/auth');

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

// The user's accounts, each with its signal count and the state of its most
// recent report - everything the accounts board needs in one call.
//   ?q=hsbc   company name, ticker, industry or country
router.get('/', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('watchlist.companyId');
    const all = (user.watchlist || []).filter(w => w.companyId);

    const q = String(req.query.q || '').trim();
    const entries = q ? all.filter(w => matchesQuery(w.companyId, q)) : all;

    // Unfiltered size, so the UI can say "1 of 12" without a second request
    res.set('X-Total-Count', String(all.length));

    const companyIds = entries.map(w => w.companyId._id);

    const [counts, reports] = await Promise.all([
      Signal.aggregate([
        { $match: { companyId: { $in: companyIds } } },
        { $group: { _id: '$companyId', count: { $sum: 1 } } },
      ]),
      Report.find({ userId: user._id, companyId: { $in: companyIds } })
        .select('companyId status progress error score.value score.band generatedAt')
        .sort({ generatedAt: -1 }),
    ]);

    const countByCompany = new Map(counts.map(c => [c._id.toString(), c.count]));

    // find() is sorted newest-first, so the first hit per company is the latest
    const latestReport = new Map();
    reports.forEach(r => {
      const key = r.companyId.toString();
      if (!latestReport.has(key)) latestReport.set(key, r);
    });

    res.json(entries.map(entry => {
      const company = entry.companyId;
      const key = company._id.toString();
      const report = latestReport.get(key);

      return {
        ...company.toObject(),
        signalCount: countByCompany.get(key) || 0,
        notes: entry.notes,
        addedAt: entry.addedAt,
        latestReport: report
          ? {
              _id: report._id,
              status: report.status,
              progress: report.progress,
              error: report.error,
              score: report.score?.value,
              band: report.score?.band,
              generatedAt: report.generatedAt,
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

    if (!entry) return res.status(404).json({ error: 'Account not in your list' });

    if (req.body.notes !== undefined) {
      entry.notes = req.body.notes;
      await req.user.save();
    }

    const { pages, tags } = req.body;
    if (!pages && !tags) {
      return res.json({ message: 'Account updated', notes: entry.notes });
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
