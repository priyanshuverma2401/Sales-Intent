const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const mongoose = require('mongoose');

const User = require('../models/User');

// One-time cleanup for accounts created while each employee carried their own
// report targeting - a `profile` sub-document (vertical, verticalCapabilities,
// keywords, targetDepartments, targetRoles, region, completedOnboarding) plus
// per-account `keywords` on each watchlist entry.
//
// Reports are now written from the Organization's company profile alone, so
// none of it is read any more. Mongoose simply ignores the fields, which means
// they would otherwise sit in the collection forever, looking live to anyone
// reading the data directly.
async function removeUserPersonas() {
  console.log('🔗 Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected');

  const stale = await User.collection
    .find(
      { $or: [{ profile: { $exists: true } }, { 'watchlist.keywords': { $exists: true } }] },
      { projection: { email: 1 } }
    )
    .toArray();

  if (!stale.length) {
    console.log('✅ No employee personas found — nothing to migrate');
    return;
  }

  console.log(`\nFound ${stale.length} account(s) still carrying persona data:`);
  stale.forEach(u => console.log(`  - ${u.email}`));

  // Written against the collection, not the model: `profile` is no longer in
  // the schema, so a model-level update would not reach it.
  const result = await User.collection.updateMany(
    { $or: [{ profile: { $exists: true } }, { 'watchlist.keywords': { $exists: true } }] },
    {
      $unset: { profile: '', 'watchlist.$[].keywords': '' },
      $set: { updatedAt: new Date() },
    }
  );

  console.log(`\n✅ Cleaned ${result.modifiedCount} account(s)`);
}

removeUserPersonas()
  .catch(error => {
    console.error('❌ Migration failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
