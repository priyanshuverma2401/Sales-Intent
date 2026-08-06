const crypto = require('crypto');
const mongoose = require('mongoose');

// Machine credentials for the public read API. A tenant can hold several, so a
// key can be rotated or revoked per integration without breaking the others.
//
// Only a SHA-256 digest of the key is stored: the plaintext is shown once, at
// creation, and is unrecoverable afterwards. A digest is enough here (unlike a
// password) because the secret is 48 random hex characters, so there is nothing
// for an offline attacker to guess.

const KEY_PREFIX = 'sm_live_';

function hashKey(key) {
  return crypto.createHash('sha256').update(String(key).trim()).digest('hex');
}

const apiKeySchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  },

  name: { type: String, required: true, trim: true },

  hash: { type: String, required: true, unique: true, index: true },
  // Enough of the key to recognise it in a list, never enough to use it
  prefix: String,
  last4: String,

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdByName: String,

  lastUsedAt: Date,
  requestCount: { type: Number, default: 0 },

  revokedAt: Date,
  revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  createdAt: { type: Date, default: Date.now },
});

// Mint a new key. The caller is responsible for showing `key` to the admin
// exactly once - it cannot be derived from the stored document.
apiKeySchema.statics.mint = function () {
  const key = `${KEY_PREFIX}${crypto.randomBytes(24).toString('hex')}`;
  return {
    key,
    hash: hashKey(key),
    prefix: key.slice(0, KEY_PREFIX.length + 4),
    last4: key.slice(-4),
  };
};

apiKeySchema.statics.hashKey = hashKey;
apiKeySchema.statics.KEY_PREFIX = KEY_PREFIX;

apiKeySchema.virtual('isActive').get(function () {
  return !this.revokedAt;
});

// The digest must never leave the server, or the "shown once" guarantee is moot
apiKeySchema.methods.toJSON = function () {
  const doc = this.toObject({ virtuals: true });
  delete doc.hash;
  delete doc.id;
  return doc;
};

module.exports = mongoose.model('ApiKey', apiKeySchema);
