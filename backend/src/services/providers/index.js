const azure = require('./azure');
const groq = require('./groq');
const gemini = require('./gemini');
const { ProviderError } = require('./errors');

// Preference order. Azure first: it is the deployment we pay for, so it has no
// free-tier day cap and the largest context window of the three. Groq is the
// fast free stand-in when Azure is unreachable, and Gemini carries the day once
// Groq's per-day token allowance is spent.
// Override with PROVIDER_ORDER=groq,gemini to take Azure out of the chain.
const REGISTRY = { azure, groq, gemini };

const DEFAULT_COOLDOWN_MS = Number(process.env.PROVIDER_COOLDOWN_MS) || 60_000;
const BAD_KEY_COOLDOWN_MS = 30 * 60_000;

// provider name -> epoch ms until which we skip it
const cooldownUntil = new Map();

function chain() {
  const order = (process.env.PROVIDER_ORDER || 'azure,groq,gemini')
    .split(',')
    .map(n => n.trim().toLowerCase())
    .filter(Boolean);

  return order.map(name => REGISTRY[name]).filter(Boolean);
}

function available() {
  return chain().filter(p => p.enabled);
}

function isCooling(provider) {
  const until = cooldownUntil.get(provider.name);
  return Boolean(until && until > Date.now());
}

function rest(provider, ms) {
  cooldownUntil.set(provider.name, Date.now() + ms);
  console.warn(`⏳ ${provider.name} on cooldown for ${Math.round(ms / 1000)}s`);
}

/**
 * Runs one completion against the first provider that will take it.
 *
 * Cooldowns are module-level and deliberately sticky: once Groq reports it is
 * out of tokens, every remaining call in that report goes to Gemini rather than
 * re-testing a provider we know is spent. The trade-off is that a report which
 * runs out mid-way is written partly by each model and reads slightly unevenly.
 * That is accepted on purpose - the alternative is losing the whole report.
 */
async function complete({ system, prompt, maxTokens, json }) {
  const providers = available();

  if (!providers.length) {
    throw new Error(
      'No AI provider is configured - set AZURE_OPENAI_* , GROQ_API_KEY or GEMINI_API_KEY on the server'
    );
  }

  // If everything is cooling down, use the one that frees up first rather than
  // failing outright: its window may well have moved on since we last looked.
  const ready = providers.filter(p => !isCooling(p));
  const queue = ready.length
    ? ready
    : [...providers].sort(
        (a, b) => (cooldownUntil.get(a.name) || 0) - (cooldownUntil.get(b.name) || 0)
      ).slice(0, 1);

  let lastError = null;

  for (const provider of queue) {
    try {
      const text = await provider.complete({ system, prompt, maxTokens, json });

      // A provider that just answered is healthy again
      cooldownUntil.delete(provider.name);
      return { text, provider: provider.name, model: provider.model };
    } catch (error) {
      const err = error instanceof ProviderError ? error : new ProviderError(error.message);
      lastError = err;

      if (err.fatalForProvider) {
        console.error(`❌ ${provider.name} rejected the API key - skipping it for 30 minutes`);
        rest(provider, BAD_KEY_COOLDOWN_MS);
        continue;
      }

      if (err.retryable) {
        console.warn(`⚠️ ${provider.name} failed (${err.status || 'network'}): ${err.detail.slice(0, 120)}`);
        rest(provider, err.retryAfter || DEFAULT_COOLDOWN_MS);
        continue;
      }

      // A 400-class error is a bad prompt, not a busy provider. Every other
      // provider would reject it too, so fail now instead of burning quota.
      throw err;
    }
  }

  throw lastError;
}

// Surfaced on /api/health so the state of the chain is visible without logs
function status() {
  return chain().map(p => ({
    name: p.name,
    model: p.model,
    enabled: p.enabled,
    coolingDownFor: isCooling(p)
      ? Math.round((cooldownUntil.get(p.name) - Date.now()) / 1000)
      : 0,
  }));
}

module.exports = { complete, status, available };
