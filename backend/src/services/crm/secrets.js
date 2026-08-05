const crypto = require('crypto');

// CRM client secrets and refresh tokens are long-lived credentials to someone
// else's system, so they are encrypted at rest rather than stored as plaintext
// fields that would end up in every database export and log dump.
//
// AES-256-GCM: the tag makes tampering detectable, which matters because a
// corrupted refresh token would otherwise fail as a confusing CRM auth error.

const ALGORITHM = 'aes-256-gcm';

// A dedicated key is preferred. Falling back to a JWT_SECRET-derived key means
// an existing deployment keeps working without a new env var, at the cost of
// tying both to one secret - set CRM_ENCRYPTION_KEY in production.
function encryptionKey() {
  const explicit = process.env.CRM_ENCRYPTION_KEY;
  if (explicit) {
    // Accept either 64 hex characters or any passphrase
    if (/^[0-9a-f]{64}$/i.test(explicit)) return Buffer.from(explicit, 'hex');
    return crypto.scryptSync(explicit, 'salesmotion-crm', 32);
  }

  if (!process.env.JWT_SECRET) {
    throw new Error('CRM_ENCRYPTION_KEY or JWT_SECRET must be set to store CRM credentials');
  }
  return crypto.scryptSync(process.env.JWT_SECRET, 'salesmotion-crm', 32);
}

function encrypt(plaintext) {
  if (!plaintext) return undefined;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);

  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

function decrypt(payload) {
  if (!payload?.data) return '';

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    encryptionKey(),
    Buffer.from(payload.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(payload.data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

module.exports = { encrypt, decrypt };
