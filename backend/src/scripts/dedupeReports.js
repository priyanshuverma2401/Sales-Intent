const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const fs = require('fs');
const mongoose = require('mongoose');

const Report = require('../models/Report');
const User = require('../models/User');

/**
 * One-time cleanup for the duplicate reports left behind before there was one
 * report per account per tenant.
 *
 * Two people adding the same prospect each got their own report on it, as did
 * every press of "Write a new one", so a team that had researched Microsoft
 * three times had three near-identical Microsoft reports sitting side by side
 * in the list. They are written through the same lens - the tenant's company
 * profile - so none of them is a second opinion; the older ones are simply
 * stale copies of the newest.
 *
 * This keeps one report per (tenant, account) and deletes the rest, along with
 * the PDFs they own on disk. Generation itself now rewrites the surviving
 * report rather than adding to the pile, so this only ever needs running once.
 *
 * Run with --dry-run first to see what it would remove.
 */

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Which report to keep out of a set of duplicates.
 *
 * The newest finished one, because that is the research the team would be
 * reading. A finished report always beats a failed or half-written one however
 * recent it is - keeping a newer failure would delete the only readable report
 * on the account.
 */
function pickSurvivor(reports) {
  const byNewest = [...reports].sort(
    (a, b) => new Date(b.generatedAt || 0) - new Date(a.generatedAt || 0)
  );

  return byNewest.find(r => r.status === 'complete') || byNewest[0];
}

/**
 * The tenant a report belongs to.
 *
 * organizationId was added after the first reports were written, so anything
 * older carries none and has to be resolved through its author. A report whose
 * author is gone, or who never joined an organization, is keyed on the author
 * instead - it is that person's own report and cannot be a duplicate of
 * anybody else's.
 */
function tenantKey(report, orgByUser) {
  const org = report.organizationId?.toString() || orgByUser.get(report.userId?.toString());
  return org ? `org:${org}` : `user:${report.userId?.toString() || 'none'}`;
}

async function dedupeReports() {
  console.log('🔗 Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected');

  if (DRY_RUN) console.log('\n🔍 Dry run — nothing will be deleted\n');

  const users = await User.find({}, 'organizationId').lean();
  const orgByUser = new Map(
    users
      .filter(u => u.organizationId)
      .map(u => [u._id.toString(), u.organizationId.toString()])
  );

  const reports = await Report.find(
    {},
    'companyId companyName organizationId userId status generatedAt pdfPath'
  ).lean();

  console.log(`Read ${reports.length} report(s)`);

  // Grouped in memory rather than with $group: the tenant of an older report is
  // only knowable by joining through its author, and the collection is small
  // enough that a pipeline to do that would be harder to read than this.
  const groups = new Map();

  for (const report of reports) {
    if (!report.companyId) continue;

    const key = `${tenantKey(report, orgByUser)}|${report.companyId.toString()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(report);
  }

  const duplicates = [...groups.values()].filter(set => set.length > 1);

  if (!duplicates.length) {
    console.log('✅ No duplicate reports — every account already has exactly one');
    return;
  }

  const doomed = [];

  console.log(`\nFound ${duplicates.length} account(s) with more than one report:\n`);

  for (const set of duplicates) {
    const keep = pickSurvivor(set);
    const drop = set.filter(r => r._id.toString() !== keep._id.toString());

    console.log(`  ${keep.companyName || keep.companyId}: keeping ${keep._id} ` +
      `(${keep.status}, ${new Date(keep.generatedAt || 0).toISOString().slice(0, 10)}), ` +
      `removing ${drop.length}`);
    drop.forEach(r => console.log(
      `      - ${r._id} (${r.status}, ${new Date(r.generatedAt || 0).toISOString().slice(0, 10)})`
    ));

    doomed.push(...drop);
  }

  console.log(`\n${doomed.length} duplicate report(s) to remove`);

  if (DRY_RUN) {
    console.log('🔍 Dry run — run again without --dry-run to apply');
    return;
  }

  // The files go before the records that point at them, or the directory keeps
  // PDFs nothing can ever reach again
  let filesRemoved = 0;
  for (const report of doomed) {
    if (report.pdfPath && fs.existsSync(report.pdfPath)) {
      try {
        fs.unlinkSync(report.pdfPath);
        filesRemoved += 1;
      } catch (error) {
        console.warn(`   ⚠️ Could not delete ${report.pdfPath}: ${error.message}`);
      }
    }
  }

  const result = await Report.deleteMany({ _id: { $in: doomed.map(r => r._id) } });

  console.log(`\n✅ Removed ${result.deletedCount} report(s) and ${filesRemoved} PDF(s)`);
}

dedupeReports()
  .catch(error => {
    console.error('❌ Cleanup failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
