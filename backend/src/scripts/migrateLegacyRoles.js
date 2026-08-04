const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const mongoose = require('mongoose');

const User = require('../models/User');

// One-time cleanup for accounts created before roles became
// owner/admin/member. They still hold role 'user', which fails schema
// validation on every save - most visibly when adding an account, since that
// writes the watchlist back onto the user document.
async function migrateLegacyRoles() {
  console.log('🔗 Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected');

  const stale = await User.collection
    .find({ role: { $nin: ['owner', 'admin', 'member'] } }, { projection: { email: 1, role: 1 } })
    .toArray();

  if (!stale.length) {
    console.log('✅ No legacy roles found - nothing to migrate');
    return;
  }

  console.log(`\nFound ${stale.length} account(s) with a legacy role:`);
  stale.forEach(u => console.log(`  - ${u.email}: '${u.role}' → 'member'`));

  // updateMany on the collection, not the model: these documents are exactly
  // the ones the schema currently rejects.
  const result = await User.collection.updateMany(
    { role: { $nin: ['owner', 'admin', 'member'] } },
    { $set: { role: 'member', updatedAt: new Date() } }
  );

  console.log(`\n✅ Updated ${result.modifiedCount} account(s)`);
}

migrateLegacyRoles()
  .catch(error => {
    console.error('❌ Migration failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
