const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const mongoose = require('mongoose');

// Import all models
const User = require('../models/User');
const Company = require('../models/Company');
const Signal = require('../models/Signal');
const Report = require('../models/Report');
const Alert = require('../models/Alert');
const Inbox = require('../models/Inbox');

async function initializeDatabase() {
  try {
    console.log('🔗 Connecting to MongoDB...');

    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('✅ Connected to MongoDB Atlas');
    console.log(`📊 Database: salesmotion`);

    // Create collections if they don't exist
    console.log('\n📝 Creating collections...');

    await User.collection.createIndex({ email: 1 }, { unique: true });
    console.log('✅ Users collection ready');

    await Company.collection.createIndex({ name: 1 }, { unique: true });
    await Company.collection.createIndex({ ticker: 1 });
    console.log('✅ Companies collection ready');

    await Signal.collection.createIndex({ companyId: 1, createdAt: -1 });
    await Signal.collection.createIndex({ type: 1 });
    await Signal.collection.createIndex({ priority: 1 });
    console.log('✅ Signals collection ready');

    await Report.collection.createIndex({ companyId: 1, generatedAt: -1 });
    console.log('✅ Reports collection ready');

    await Alert.collection.createIndex({ userId: 1 });
    console.log('✅ Alerts collection ready');

    await Inbox.collection.createIndex({ userId: 1, createdAt: -1 });
    console.log('✅ Inbox collection ready');

    console.log('\n✨ Database initialization complete!');
    console.log('\n📊 Collections created:');
    console.log('  - users');
    console.log('  - companies');
    console.log('  - signals');
    console.log('  - reports');
    console.log('  - alerts');
    console.log('  - inboxes');

    console.log('\n🎉 Ready to start the application!');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Database initialization error:', error);
    process.exit(1);
  }
}

// Run initialization
initializeDatabase();
