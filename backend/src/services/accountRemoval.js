const fs = require('fs');
const User = require('../models/User');
const Report = require('../models/Report');
const Signal = require('../models/Signal');
const Alert = require('../models/Alert');

/**
 * Take an account off the whole tenant's books.
 *
 * Shared by the two doors that lead here - removing the account outright, and
 * deleting its report - because there is one report per account, so clearing
 * either one leaves the other with nothing to be about. Both have to do the
 * same teardown or one of them leaves debris behind.
 *
 * Removing is for everyone at once: since a prospect is one shared account
 * rather than a copy per seat, a delete that left it on four other people's
 * boards would not be a delete.
 *
 * The Company document itself survives. It is shared with every other tenant
 * watching the same prospect, and none of them asked for it to go.
 *
 * @param {object} company   the Company document being cleared
 * @param {object} req       the authenticated request, for the caller's tenant
 * @returns {Promise<{reportsDeleted: number}>}
 */
async function removeForTenant(company, req) {
  const orgId = req.organization?._id;
  const memberIds = orgId
    ? await User.distinct('_id', { organizationId: orgId })
    : [req.user._id];

  await User.updateMany(
    { _id: { $in: memberIds } },
    { $pull: { watchlist: { companyId: company._id } } }
  );

  // Each report owns a rendered PDF on disk, so the files go before the
  // records that point at them - otherwise the directory grows forever.
  const reports = await Report.find({
    companyId: company._id,
    $or: [{ organizationId: orgId }, { userId: { $in: memberIds } }],
  }).select('pdfPath');

  reports.forEach((report) => {
    if (report.pdfPath && fs.existsSync(report.pdfPath)) fs.unlink(report.pdfPath, () => {});
  });
  await Report.deleteMany({ _id: { $in: reports.map(r => r._id) } });

  // Only this tenant's own signals. Signals derived from public sources are
  // shared with every other tenant watching the same company.
  if (orgId) await Signal.deleteMany({ companyId: company._id, organizationId: orgId });

  // An alert rule on an account nobody is watching would keep firing
  await Alert.deleteMany({ companyId: company._id, userId: { $in: memberIds } });

  return { reportsDeleted: reports.length };
}

module.exports = { removeForTenant };
