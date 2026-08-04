// Groq and Gemini report failures in completely different shapes. The failover
// chain needs one vocabulary to decide "try the next provider or give up", so
// every provider funnels its SDK errors through here first.

class ProviderError extends Error {
  constructor(message, { provider, status, detail, retryAfter, cause } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status;
    this.detail = detail || message;
    this.retryAfter = retryAfter;
    this.cause = cause;
  }

  // Worth handing to the next provider: we are over a limit, or this one is ill.
  get retryable() {
    return this.status === 413 || this.status === 429 || this.status >= 500 || !this.status;
  }

  // The key is wrong. Another provider may still work, but this one never will
  // until someone fixes the config, so it earns a long time-out.
  get fatalForProvider() {
    return this.status === 401 || this.status === 403;
  }
}

// Pulls "try again in 7.2s" style hints out of whatever the provider said
function parseRetryAfter(detail) {
  const match = /try again in ([\d.]+)\s*(ms|s|m)?/i.exec(detail || '');
  if (!match) return undefined;

  const value = Number(match[1]);
  if (!Number.isFinite(value)) return undefined;

  const unit = (match[2] || 's').toLowerCase();
  if (unit === 'ms') return value;
  if (unit === 'm') return value * 60_000;
  return value * 1000;
}

// Gemini's SDK folds the HTTP status into the message text rather than a field,
// e.g. "[GoogleGenerativeAI Error]: ... [429 Too Many Requests] ...".
function extractStatus(error) {
  const direct = error?.status || error?.response?.status || error?.code;
  if (Number.isInteger(direct)) return direct;

  const fromText = /\[(\d{3})\s/.exec(error?.message || '');
  return fromText ? Number(fromText[1]) : undefined;
}

function toProviderError(error, provider) {
  if (error instanceof ProviderError) return error;

  const detail =
    error?.error?.message ||
    error?.response?.data?.error?.message ||
    error?.message ||
    'unknown provider error';

  return new ProviderError(detail, {
    provider,
    status: extractStatus(error),
    detail,
    retryAfter: parseRetryAfter(detail),
    cause: error,
  });
}

module.exports = { ProviderError, toProviderError };
