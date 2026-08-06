const { AzureOpenAI } = require('openai');
const { toProviderError, ProviderError } = require('./errors');

// The primary provider. Unlike Groq and Gemini this one is a paid deployment we
// own, so it has no free-tier day cap to run into - Groq and Gemini sit behind
// it purely as insurance against an outage or a throttled region.
//
// Azure differs from the other two in one way that matters: the request names a
// DEPLOYMENT, not a model. The deployment name is whatever was typed in AI
// Foundry and is often nothing like the model it runs, so AZURE_OPENAI_MODEL is
// carried separately - only for logging and Report.aiModel.
let client = null;

const PLACEHOLDER = /^\s*$|^(placeholder|your-|<)/i;

function configured(value) {
  return Boolean(value) && !PLACEHOLDER.test(value);
}

function getClient() {
  if (!client) {
    client = new AzureOpenAI({
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-10-21',
      deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
    });
  }
  return client;
}

// GPT-5 and the o-series reject the parameters every other chat model takes:
// `max_tokens` must be `max_completion_tokens`, and `temperature` is fixed at 1.
// Both names are checked because a deployment is frequently named after the
// model it serves, which is the only hint available when AZURE_OPENAI_MODEL is
// left unset.
// Written loosely because deployment names drop the hyphen as often as not
// ("sales-gpt5"). It must not catch gpt-4o / gpt-4o-mini or gpt-35-turbo.
const REASONING_MODEL = /gpt-?5|(^|[^a-z0-9])o[134]([^0-9]|$)/i;

function looksLikeReasoningModel() {
  const hint = `${process.env.AZURE_OPENAI_MODEL || ''} ${process.env.AZURE_OPENAI_DEPLOYMENT || ''}`;
  return REASONING_MODEL.test(hint);
}

// A 400 naming one of those parameters means the guess above was wrong. The
// message is the only signal Azure gives, so match on it and retry the other
// way rather than failing a report over a config detail.
function isParameterStyleError(error) {
  const status = error?.status || error?.response?.status;
  if (status !== 400) return false;

  const detail = error?.error?.message || error?.message || '';
  return /max_tokens|max_completion_tokens|temperature|reasoning_effort/i.test(detail);
}

// A reasoning model spends max_completion_tokens on thinking BEFORE it writes
// anything, and the caller's maxTokens is sized for the answer alone. Measured
// against gpt-5-mini: at the default effort a 300-token budget was consumed
// entirely by reasoning and came back empty, while 'low' spent 64-128. So ask
// for a low effort and add headroom on top of what the caller wanted - unused
// tokens are not billed, an empty completion costs the whole call.
const REASONING_RESERVE = Number(process.env.AZURE_REASONING_RESERVE) || 1024;

function reasoningEffort() {
  return process.env.AZURE_REASONING_EFFORT || 'low';
}

function buildBody({ messages, maxTokens, json, deployment, reasoning }) {
  return {
    model: deployment,
    messages,
    ...(reasoning
      ? {
          max_completion_tokens: maxTokens + REASONING_RESERVE,
          ...(reasoningEffort() === 'default' ? {} : { reasoning_effort: reasoningEffort() }),
        }
      : { max_tokens: maxTokens, temperature: 0.4 }),
    ...(json ? { response_format: { type: 'json_object' } } : {}),
  };
}

module.exports = {
  name: 'azure',

  // Reported as the model that wrote the report. The deployment name is the
  // only value guaranteed to exist, so it stands in when the model is unset.
  get model() {
    return process.env.AZURE_OPENAI_MODEL || process.env.AZURE_OPENAI_DEPLOYMENT || 'azure-openai';
  },

  // All three are required: a key with no endpoint cannot be called, and a
  // request with no deployment is a 404 rather than a useful error.
  get enabled() {
    return (
      configured(process.env.AZURE_OPENAI_ENDPOINT) &&
      configured(process.env.AZURE_OPENAI_API_KEY) &&
      configured(process.env.AZURE_OPENAI_DEPLOYMENT)
    );
  },

  async complete({ system, prompt, maxTokens, json }) {
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });

    let reasoning = looksLikeReasoningModel();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const completion = await getClient().chat.completions.create(
          buildBody({ messages, maxTokens, json, deployment, reasoning })
        );

        const text = completion.choices?.[0]?.message?.content || '';

        // A reasoning model can spend the whole budget thinking and return an
        // empty message. That parses as "no content" three layers up with no
        // clue why, so name it here instead.
        const finish = completion.choices?.[0]?.finish_reason;
        if (!text && finish === 'length') {
          throw new ProviderError(
            `Azure deployment "${deployment}" hit the token limit before writing an answer` +
              (reasoning
                ? ' - the reasoning budget consumed it. Raise AZURE_REASONING_RESERVE or lower AZURE_REASONING_EFFORT.'
                : ' - raise maxTokens or shorten the prompt.'),
            { provider: 'azure', status: 502 }
          );
        }

        return text;
      } catch (error) {
        if (attempt === 0 && isParameterStyleError(error)) {
          console.warn(
            `⚙️ Azure deployment "${deployment}" wants ${reasoning ? 'classic' : 'reasoning-model'} ` +
              'parameters - switching and retrying'
          );
          reasoning = !reasoning;
          continue;
        }

        throw toProviderError(error, 'azure');
      }
    }
  },
};
