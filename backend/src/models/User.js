const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: true,
  },
  lastName: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
  },
  password: {
    type: String,
    required: true,
  },

  // Every seat belongs to a subscribing Organization. `company` is kept as the
  // denormalised display name so older records and the UI keep working.
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    index: true,
  },
  company: {
    type: String,
    required: true,
  },

  jobTitle: String,

  role: {
    type: String,
    enum: ['owner', 'admin', 'member'],
    default: 'member',
  },

  // A seat carries no report targeting of its own: every report is written from
  // the Organization's company profile, so two people at the same company get
  // the same lens on the same prospect.

  watchlist: [{
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
    notes: String,
    addedAt: { type: Date, default: Date.now },
  }],

  preferences: {
    notifications: { type: Boolean, default: true },
    emailAlerts: { type: Boolean, default: true },
    theme: { type: String, enum: ['light', 'dark'], default: 'light' },
  },

  lastLogin: Date,
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Accounts created before the owner/admin/member enum carry role 'user'. Left
// alone they fail validation on any save - including the watchlist write that
// adds an account - so map them onto the current vocabulary as they pass through.
const LEGACY_ROLES = { user: 'member' };

userSchema.pre('validate', function(next) {
  if (LEGACY_ROLES[this.role]) {
    this.role = LEGACY_ROLES[this.role];
  }
  next();
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    return next();
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Method to compare passwords
userSchema.methods.comparePassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Remove password from JSON response
userSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  return user;
};

// Who a report is addressed to. Nothing here steers the analysis - it only
// names the reader on the cover.
userSchema.methods.toReader = function () {
  return {
    name: `${this.firstName} ${this.lastName}`.trim(),
    email: this.email,
    jobTitle: this.jobTitle,
  };
};

module.exports = mongoose.model('User', userSchema);
