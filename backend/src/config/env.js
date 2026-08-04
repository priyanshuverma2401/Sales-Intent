/**
 * Startup configuration check.
 *
 * A missing JWT_SECRET used to fail silently and confusingly in production:
 * jwt.sign() threw a 500 on every login while jwt.verify() 401'd every other
 * request, and nothing in the logs said why. Deploys are the moment this is
 * most likely to happen, so the process refuses to boot instead — Render shows
 * the message below in the deploy log and the bad revision never goes live.
 */

// Shipped in .env.example as a placeholder. If it reaches a real deployment,
// every token the app issues is forgeable by anyone who has read the repo.
const PLACEHOLDER_SECRETS = [
  'your-super-secret-key-change-in-production',
  'change-me',
  'secret',
];

const REQUIRED = [
  {
    key: 'MONGODB_URI',
    hint: 'MongoDB Atlas connection string, e.g. mongodb+srv://user:pass@cluster.mongodb.net/salesmotion',
  },
  {
    key: 'JWT_SECRET',
    hint: 'Long random string used to sign login tokens. Generate one with: openssl rand -base64 48',
  },
];

function validateEnv({ exitOnFailure = true } = {}) {
  const problems = [];

  for (const { key, hint } of REQUIRED) {
    if (!process.env[key] || !process.env[key].trim()) {
      problems.push(`${key} is not set. ${hint}`);
    }
  }

  const secret = (process.env.JWT_SECRET || '').trim();

  if (secret && PLACEHOLDER_SECRETS.includes(secret)) {
    problems.push('JWT_SECRET is still the example placeholder. Replace it with a real random value.');
  }

  // Short secrets are brute-forceable offline once someone holds a single token.
  if (secret && !PLACEHOLDER_SECRETS.includes(secret) && secret.length < 32) {
    problems.push(`JWT_SECRET is only ${secret.length} characters. Use at least 32.`);
  }

  // Production served from a browser on another domain needs the real frontend
  // origin, or every request is refused by CORS with no useful error client-side.
  if (process.env.NODE_ENV === 'production' && !process.env.FRONTEND_URL) {
    problems.push(
      'FRONTEND_URL is not set. In production it must list the deployed frontend origin ' +
      '(e.g. https://salesmotion.pages.dev), otherwise CORS blocks the browser.'
    );
  }

  if (problems.length) {
    console.error('\n❌ Cannot start: the server configuration is incomplete.\n');
    problems.forEach((p, i) => console.error(`  ${i + 1}. ${p}`));
    console.error('\nSet these in the Render dashboard under Environment, then redeploy.\n');

    if (exitOnFailure) process.exit(1);
    return false;
  }

  return true;
}

module.exports = { validateEnv, PLACEHOLDER_SECRETS };
