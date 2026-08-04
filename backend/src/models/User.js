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

  // The employee half of the report prompt. The org supplies what the company
  // can sell; this supplies the slice of it this person actually sells, and the
  // themes they want every prospect read through.
  profile: {
    // Industry/vertical the employee sells INTO, e.g. "Banking & Financial Services"
    vertical: String,
    // Capabilities relevant to that vertical, e.g. "KYC/AML automation"
    verticalCapabilities: [String],
    // Pitch themes, e.g. "GenAI solutions", "Copilot solutions". Reports are
    // written through this lens: how does the prospect need these?
    keywords: [String],
    targetDepartments: [String],
    targetRoles: [String],
    region: String,
    completedOnboarding: { type: Boolean, default: false },
  },

  watchlist: [{
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
    // Per-account overrides. Empty means "use my profile defaults".
    keywords: [String],
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

// The employee context handed to the AI engine, merged with any per-account
// keyword override supplied when the prospect was added.
userSchema.methods.toSellerProfile = function (overrideKeywords) {
  const profile = this.profile || {};
  const keywords = overrideKeywords?.length ? overrideKeywords : (profile.keywords || []);

  return {
    name: `${this.firstName} ${this.lastName}`.trim(),
    jobTitle: this.jobTitle,
    vertical: profile.vertical,
    verticalCapabilities: profile.verticalCapabilities || [],
    keywords,
    targetDepartments: profile.targetDepartments || [],
    targetRoles: profile.targetRoles || [],
    region: profile.region,
  };
};

module.exports = mongoose.model('User', userSchema);
