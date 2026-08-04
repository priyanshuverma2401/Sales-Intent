const Groq = require('groq-sdk');
const { toProviderError } = require('./errors');

// Lazily constructed so a missing key does not throw at require time - the app
// must still boot with the AI layer disabled, as it always has.
let client = null;

function getClient() {
  if (!client) client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return client;
}

module.exports = {
  name: 'groq',

  get model() {
    return process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  },

  get enabled() {
    const key = process.env.GROQ_API_KEY;
    return Boolean(key) && key !== 'placeholder_get_from_groq';
  },

  async complete({ system, prompt, maxTokens, json }) {
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });

    try {
      const completion = await getClient().chat.completions.create({
        model: this.model,
        max_tokens: maxTokens,
        temperature: 0.4,
        messages,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      });

      return completion.choices?.[0]?.message?.content || '';
    } catch (error) {
      throw toProviderError(error, 'groq');
    }
  },
};
