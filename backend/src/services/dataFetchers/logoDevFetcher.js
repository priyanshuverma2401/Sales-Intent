const axios = require('axios');

/**
 * Logo.dev - company name to domain, and the logo that goes with it.
 *
 * Wikidata answers what a company *is* but only knows the ones somebody wrote
 * an encyclopedia article about, which is why "snapchat" came back empty and
 * "uber" came back as a museum in Bremen. Logo.dev indexes 50M+ companies by
 * name and returns the homepage for each, so it is the source that decides
 * which real company a rep meant. Wikidata then fills in the firmographics for
 * the ones it knows.
 *
 * Both keys are optional: without them every method here is a no-op and the
 * search box falls back to the encyclopedia sources alone.
 *
 *   LOGODEV_SECRET_KEY       Brand Search. Server-side only - it is a secret.
 *   LOGODEV_PUBLISHABLE_KEY  Image CDN. Appears in the <img> src, so it is
 *                            public by design.
 */

const SEARCH_URL = 'https://api.logo.dev/search';
const IMAGE_HOST = 'https://img.logo.dev';

// A suggestion box fires one of these per debounce, so the same query is asked
// for over and over - by the same rep refining it and by every other seat
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 500;

class LogoDevFetcher {
  constructor() {
    this.cache = new Map();
  }

  get secretKey() {
    return process.env.LOGODEV_SECRET_KEY || '';
  }

  get publishableKey() {
    return process.env.LOGODEV_PUBLISHABLE_KEY || '';
  }

  /** Whether name search is configured. The image CDN is a separate key. */
  get enabled() {
    return Boolean(this.secretKey);
  }

  /**
   * A company's logo, by domain.
   *
   * Built here rather than taken from the search response so the size and
   * format the report actually needs are asked for - pdfkit cannot rasterise an
   * SVG, and the suggestion row wants a small PNG.
   *
   * `fallback=404` matters: by default the CDN draws a lettered monogram for a
   * domain it has no logo for, which would be stored as the company's logo and
   * printed on the report cover as though it were the real mark.
   */
  imageUrl(domain, { size = 128, format = 'png', monogram = false } = {}) {
    const host = this.hostname(domain);
    if (!host || !this.publishableKey) return undefined;

    const params = new URLSearchParams({
      token: this.publishableKey,
      size: String(size),
      format,
    });
    if (!monogram) params.set('fallback', '404');

    return `${IMAGE_HOST}/${encodeURIComponent(host)}?${params.toString()}`;
  }

  /**
   * Companies whose name matches the query, best first.
   *
   * @param {string} query
   * @param {object} [options]
   * @param {'typeahead'|'match'} [options.strategy] 'typeahead' ranks popular
   *   prefix matches, which is what a search box wants. 'match' is for
   *   resolving a name we already believe in.
   * @returns {Promise<Array<{name: string, domain: string, logoUrl?: string}>>}
   *   empty when the key is missing or the call fails - never throws, because
   *   this is one of three sources behind the box and the other two still work.
   */
  async search(query, { strategy = 'typeahead', limit = 12 } = {}) {
    const term = String(query || '').trim();
    if (!term || !this.enabled) return [];

    const cacheKey = `${strategy}:${term.toLowerCase()}`;
    const cached = this.cached(cacheKey);
    if (cached) return cached;

    let data;
    try {
      const response = await axios.get(SEARCH_URL, {
        params: { q: term, strategy },
        headers: { Authorization: `Bearer ${this.secretKey}` },
        timeout: 6000,
      });
      data = response.data;
    } catch (error) {
      const status = error.response?.status;
      console.warn(
        `⚠️ Logo.dev search failed for "${term}": ${status ? `HTTP ${status} - ` : ''}${error.message}`
      );
      return [];
    }

    // The documented response is a bare array. Accepting the wrapped shape too
    // costs one line and means a future envelope does not empty the search box.
    const rows = Array.isArray(data) ? data : data?.results || data?.data || [];

    const results = rows
      .map(row => {
        const domain = this.hostname(row?.domain || row?.website || row?.url);
        const name = String(row?.name || '').trim();
        if (!name || !domain) return null;

        return {
          name,
          domain,
          // Our own URL when the publishable key is set, so size and fallback
          // are ours to choose; otherwise whatever the API handed back
          logoUrl: this.imageUrl(domain) || row?.logo_url || row?.logoUrl,
        };
      })
      .filter(Boolean)
      .slice(0, limit);

    this.cache_(cacheKey, results);
    return results;
  }

  /** The single company a name resolves to, or null when it is ambiguous. */
  async resolve(name) {
    const [best] = await this.search(name, { strategy: 'match', limit: 1 });
    return best || null;
  }

  cached(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.at > CACHE_TTL_MS) {
      this.cache.delete(key);
      return null;
    }

    return entry.results;
  }

  cache_(key, results) {
    // Insertion-ordered, so the first key is the oldest
    if (this.cache.size >= CACHE_MAX) {
      this.cache.delete(this.cache.keys().next().value);
    }
    this.cache.set(key, { at: Date.now(), results });
  }

  hostname(url) {
    return String(url || '')
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/\/.*$/, '')
      .toLowerCase() || undefined;
  }
}

module.exports = new LogoDevFetcher();
