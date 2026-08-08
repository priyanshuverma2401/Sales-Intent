const axios = require('axios');

/**
 * Brandfetch - the same name-to-domain search logo.dev does, plus the one thing
 * nothing else here has: firmographics for private companies.
 *
 * Its Brand API answers by domain with headcount, founding year, industry, the
 * city and country the company operates from, and its own LinkedIn and
 * Crunchbase pages. Wikidata has all of that too but only for the companies
 * somebody wrote an encyclopedia article about, which is why a cover reads
 * "Headquartered in Unknown" for most real prospects. This fills those in.
 *
 * Two keys, both optional and independent:
 *
 *   BRANDFETCH_CLIENT_ID  Brand Search and the logo CDN. Public by design - it
 *                         travels in the image URL the browser requests.
 *   BRANDFETCH_API_KEY    The Brand API. A bearer secret; server-side only.
 */

const SEARCH_URL = 'https://api.brandfetch.io/v2/search';
const BRAND_URL = 'https://api.brandfetch.io/v2/brands/domain';
const CDN_HOST = 'https://cdn.brandfetch.io';

const SEARCH_TTL_MS = 30 * 60 * 1000;
// A company's firmographics do not move in a day, and the same account is
// enriched again on every report rerun
const BRAND_TTL_MS = 12 * 60 * 60 * 1000;
const CACHE_MAX = 500;

class BrandfetchFetcher {
  constructor() {
    this.cache = new Map();
  }

  get clientId() {
    return process.env.BRANDFETCH_CLIENT_ID || '';
  }

  get apiKey() {
    return process.env.BRANDFETCH_API_KEY || '';
  }

  /** Name search and logo images - the public client id is enough for both. */
  get searchEnabled() {
    return Boolean(this.clientId);
  }

  /** Firmographics by domain - needs the secret key. */
  get brandEnabled() {
    return Boolean(this.apiKey);
  }

  /**
   * A company's mark from the CDN, sized for where it is being shown.
   *
   * Used for display only. What gets stored as the account's logo comes from
   * the Brand API instead, because the CDN answers a domain it has no logo for
   * with a generated lettermark - fine in a search row, wrong on a report cover
   * where it would pass for the company's actual mark.
   */
  logoUrl(domain, { size = 128, type = 'icon', format = 'png' } = {}) {
    const host = this.hostname(domain);
    if (!host || !this.clientId) return undefined;

    return `${CDN_HOST}/${host}/h/${size}/w/${size}/${type}.${format}?c=${encodeURIComponent(this.clientId)}`;
  }

  /**
   * Companies whose name matches the query.
   *
   * @returns {Promise<Array<{name: string, domain: string, logoUrl?: string}>>}
   *   empty when unconfigured or the call fails - never throws, because this is
   *   one of several sources behind the search box.
   */
  async search(query, { limit = 12 } = {}) {
    const term = String(query || '').trim();
    if (!term || !this.searchEnabled) return [];

    const cacheKey = `search:${term.toLowerCase()}`;
    const cached = this.cached(cacheKey, SEARCH_TTL_MS);
    if (cached) return cached;

    let rows;
    try {
      const { data } = await axios.get(`${SEARCH_URL}/${encodeURIComponent(term)}`, {
        params: { c: this.clientId },
        timeout: 6000,
      });
      rows = Array.isArray(data) ? data : data?.results || [];
    } catch (error) {
      const status = error.response?.status;
      console.warn(
        `⚠️ Brandfetch search failed for "${term}": ${status ? `HTTP ${status} - ` : ''}${error.message}`
      );
      return [];
    }

    const results = rows
      .map(row => {
        const domain = this.hostname(row?.domain);
        const name = String(row?.name || '').trim() || domain;
        if (!domain) return null;

        // The icon the API stated wins: it addresses the exact brand record
        // that matched, where a URL built from the domain is a lookup that may
        // or may not land on the same one
        return { name, domain, logoUrl: row?.icon || this.logoUrl(domain) };
      })
      .filter(Boolean)
      .slice(0, limit);

    this.remember(cacheKey, results);
    return results;
  }

  /**
   * Everything Brandfetch knows about one company, by domain.
   *
   * @returns {Promise<object|null>} normalised firmographics, or null when the
   *   key is missing, the domain is unknown to Brandfetch, or the call failed.
   *   Never throws - a report must still be written without it.
   */
  async brand(domain) {
    const host = this.hostname(domain);
    if (!host || !this.brandEnabled) return null;

    const cacheKey = `brand:${host}`;
    const cached = this.cached(cacheKey, BRAND_TTL_MS);
    if (cached !== null && cached !== undefined) return cached;

    let data;
    try {
      const response = await axios.get(`${BRAND_URL}/${encodeURIComponent(host)}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        timeout: 8000,
      });
      data = response.data;
    } catch (error) {
      const status = error.response?.status;
      // 404 is an answer, not a failure: Brandfetch has no record of this
      // domain, and asking again on the next report will not change that
      if (status === 404) {
        this.remember(cacheKey, null);
        return null;
      }
      console.warn(
        `⚠️ Brandfetch brand lookup failed for ${host}: ${status ? `HTTP ${status} - ` : ''}${error.message}`
      );
      return null;
    }

    const facts = this.normalise(data, host);
    this.remember(cacheKey, facts);
    return facts;
  }

  /** The API's payload reduced to the fields a report cover is built from. */
  normalise(data, host) {
    if (!data) return null;

    const company = data.company || {};
    const location = company.location || {};

    // Highest-confidence industry first; the API sorts by score but says so
    // only in the field, so it is not taken on trust
    const industry = [...(company.industries || [])]
      .sort((a, b) => (b?.score || 0) - (a?.score || 0))
      .map(item => item?.name)
      .filter(Boolean)[0];

    const employees = Number(company.employees);
    const foundedYear = Number(company.foundedYear);

    return {
      name: data.name || undefined,
      website: data.domain ? `https://${this.hostname(data.domain)}` : `https://${host}`,
      description: data.description || undefined,
      industry: industry || undefined,
      employees: Number.isFinite(employees) && employees > 0 ? Math.round(employees) : undefined,
      foundedYear: Number.isFinite(foundedYear) && foundedYear > 1500 ? foundedYear : undefined,
      city: location.city || undefined,
      state: location.state || undefined,
      country: location.country || undefined,
      logoUrl: this.bestLogo(data.logos),
      profiles: this.profiles(data.links),
      source: 'Brandfetch',
    };
  }

  /**
   * The logo asset to store.
   *
   * A wordmark beats an icon on a report cover, and a raster beats a vector
   * because pdfkit cannot draw SVG. Only real assets are returned - the CDN's
   * generated lettermark never reaches this path.
   */
  bestLogo(logos = []) {
    const rank = { logo: 0, symbol: 1, icon: 2, other: 3 };
    const formatRank = { png: 0, webp: 1, jpeg: 2, jpg: 2, svg: 3 };

    const candidates = [];
    for (const logo of logos || []) {
      for (const format of logo?.formats || []) {
        if (!format?.src) continue;
        candidates.push({
          src: format.src,
          // A logo drawn for a light background is the one that works on the
          // white card both the web report and the PDF put it on
          score:
            (rank[logo.type] ?? 4) * 10 +
            (formatRank[String(format.format || '').toLowerCase()] ?? 4) +
            (logo.theme === 'dark' ? 0.5 : 0),
        });
      }
    }

    return candidates.sort((a, b) => a.score - b.score)[0]?.src;
  }

  /** The company's own pages on the sites the report links out to. */
  profiles(links = []) {
    const find = name =>
      (links || []).find(link => String(link?.name || '').toLowerCase() === name)?.url;

    return {
      linkedin: find('linkedin') || undefined,
      crunchbase: find('crunchbase') || undefined,
    };
  }

  cached(key, ttl) {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() - entry.at > ttl) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  remember(key, value) {
    // Insertion-ordered, so the first key is the oldest
    if (this.cache.size >= CACHE_MAX) {
      this.cache.delete(this.cache.keys().next().value);
    }
    this.cache.set(key, { at: Date.now(), value });
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

module.exports = new BrandfetchFetcher();
