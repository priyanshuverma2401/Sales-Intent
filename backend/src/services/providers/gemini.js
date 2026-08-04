const { GoogleGenerativeAI } = require('@google/generative-ai');
const { toProviderError, ProviderError } = require('./errors');

// The fallback provider. Its free tier is far more generous than Groq's per-day
// token allowance, and its context window is large enough that the source caps
// in intelligenceService can be raised well past what Groq tolerates.
let client = null;

function getClient() {
  if (!client) client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return client;
}

module.exports = {
  name: 'gemini',

  get model() {
    return process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  },

  get enabled() {
    const key = process.env.GEMINI_API_KEY;
    return Boolean(key) && !/^(placeholder|your-)/i.test(key);
  },

  async complete({ system, prompt, maxTokens, json }) {
    try {
      const model = getClient().getGenerativeModel({
        model: this.model,
        // Gemini takes the system prompt as its own field rather than a message
        ...(system ? { systemInstruction: system } : {}),
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.4,
          // Native JSON mode - stricter than Groq's, so the brace-hunting
          // fallback in aiEngine.parseJSON rarely has to do anything here
          ...(json ? { responseMimeType: 'application/json' } : {}),
        },
      });

      const result = await model.generateContent(prompt);
      const text = result?.response?.text() || '';

      // A response truncated by maxOutputTokens comes back as valid-but-partial
      // JSON, which fails parsing further up with no clue why. Say so instead.
      const finish = result?.response?.candidates?.[0]?.finishReason;
      if (!text && finish) {
        throw new ProviderError(`Gemini returned no text (finishReason: ${finish})`, {
          provider: 'gemini',
          status: 502,
        });
      }

      return text;
    } catch (error) {
      throw toProviderError(error, 'gemini');
    }
  },
};
