const axios = require('axios');

/**
 * The company infobox on a Wikipedia article — revenue, headcount, industry.
 *
 * Wikidata is the better-structured source and is tried first, but its revenue
 * property is sparsely populated: Microsoft has a decade of it and Standard
 * Chartered has none. The infobox on the article carries a figure for almost
 * every company large enough to be a prospect, and it is maintained against the
 * annual report, so it fills the gap Wikidata leaves.
 *
 * The cost is that it arrives as wikitext — "{{increase}} [[United States
 * dollar|US$]]20.942&nbsp;billion (2025)" — which is what most of this file is
 * about turning back into a number, a currency and a year.
 */

const WIKI_API = 'https://en.wikipedia.org/w/api.php';

const HEADERS = {
  'User-Agent': 'SalesMotion/1.0 (sales intelligence platform)',
};

// Written currency marks, longest first so "US$" is matched before "$"
const CURRENCY_MARKS = [
  ['US$', 'USD'], ['A$', 'AUD'], ['C$', 'CAD'], ['HK$', 'HKD'], ['S$', 'SGD'],
  ['NT$', 'TWD'], ['R$', 'BRL'], ['USD', 'USD'], ['EUR', 'EUR'], ['GBP', 'GBP'],
  ['INR', 'INR'], ['JPY', 'JPY'], ['CNY', 'CNY'], ['CHF', 'CHF'], ['SEK', 'SEK'],
  ['€', 'EUR'], ['£', 'GBP'], ['¥', 'JPY'], ['₹', 'INR'], ['₩', 'KRW'], ['$', 'USD'],
];

const MAGNITUDES = {
  trillion: 1e12,
  billion: 1e9,
  million: 1e6,
  thousand: 1e3,
  // Indian companies report in crore and lakh, and Wikipedia keeps them that way
  crore: 1e7,
  lakh: 1e5,
};

class InfoboxFetcher {
  /**
   * One call against the API, retried once when the anonymous quota is hit.
   * Wikipedia throttles bursts, and a report firing this alongside the two
   * Wikidata calls is exactly such a burst.
   */
  async request(params) {
    for (let attempt = 0; ; attempt++) {
      try {
        const { data } = await axios.get(WIKI_API, {
          params: { ...params, format: 'json' },
          headers: HEADERS,
          timeout: 10000,
        });
        return data;
      } catch (error) {
        if (attempt >= 1 || error.response?.status !== 429) throw error;
        const wait = Number(error.response.headers?.['retry-after']) * 1000 || 1200;
        await new Promise(resolve => setTimeout(resolve, Math.min(wait, 5000)));
      }
    }
  }

  // ---- wikitext cleanup ---------------------------------------------------

  /**
   * Reduce one infobox field to the plain text it renders as.
   *
   * Templates are the awkward part. `{{increase}}` is a green arrow and carries
   * no information; `{{small|(2026)}}` wraps text that matters; `{{USD|64.424
   * billion}}` *is* the value. So they are unwrapped rather than stripped, and
   * the two that state a currency are rewritten before the rest are flattened.
   */
  clean(raw) {
    let text = String(raw || '');

    // Citations, comments and markup that never renders as prose. Line breaks
    // become separators first - several fields are <br />-delimited lists, and
    // flattening them to spaces would run "Consulting" into "Outsourcing".
    text = text
      .replace(/<ref[^>]*\/>/gi, '')
      .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<br\s*\/?>/gi, '; ')
      .replace(/<[^>]+>/g, ' ');

    // {{INRConvert|181638|c}} — an amount in crore, with the unit as a flag
    text = text.replace(
      /\{\{\s*INRConvert\s*\|\s*([\d,.]+)\s*(?:\|\s*([a-z]+))?[^}]*\}\}/gi,
      (_, amount, unit) => {
        const scale = { c: 'crore', l: 'lakh', b: 'billion', m: 'million', t: 'trillion' };
        return ` INR ${amount} ${scale[String(unit || '').toLowerCase()] || ''} `;
      }
    );

    // {{USD|64.424 billion|link=yes}} and its siblings
    text = text.replace(
      /\{\{\s*(USD|EUR|GBP|JPY|CNY|INR|CHF|CAD|AUD)\s*\|\s*([^|}]+)[^}]*\}\}/gi,
      (_, code, amount) => ` ${code.toUpperCase()} ${amount} `
    );

    // Everything else: keep the first argument, drop the template name. This
    // turns {{small|(2026)}} into (2026) and {{increase}} into nothing.
    for (let pass = 0; pass < 3 && text.includes('{{'); pass++) {
      text = text.replace(/\{\{([^{}]*)\}\}/g, (_, body) => {
        const parts = body.split('|');
        return parts.length > 1 ? ` ${parts[1]} ` : ' ';
      });
    }

    // [[United States dollar|US$]] renders as the piped label
    text = text
      .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
      .replace(/\[\[([^\]]*)\]\]/g, '$1')
      .replace(/&nbsp;|&#160;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/'{2,}/g, '');

    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * The four-digit year in a trailing "(2025)", "(March 2026)" or "(FY2023)".
   * No word boundary before the digits — "FY2023" has none.
   */
  year(text) {
    const years = [...String(text).matchAll(/\([^()]*?(?<!\d)((?:19|20)\d{2})(?!\d)[^()]*\)/g)]
      .map(m => Number(m[1]));
    return years.length ? years[years.length - 1] : null;
  }

  /** "US$20.942 billion (2025)" -> { value, currency, asOf } */
  parseAmount(raw) {
    const text = this.clean(raw);
    if (!text) return null;

    const marks = CURRENCY_MARKS.map(([mark]) =>
      mark.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    ).join('|');

    const match = new RegExp(
      `(${marks})?\\s*([\\d][\\d,]*(?:\\.\\d+)?)\\s*(${Object.keys(MAGNITUDES).join('|')})?`,
      'i'
    ).exec(text);
    if (!match) return null;

    const amount = Number(match[2].replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) return null;

    const currency = match[1]
      ? CURRENCY_MARKS.find(([mark]) => mark.toLowerCase() === match[1].toLowerCase())?.[1]
      : null;
    const scale = match[3] ? MAGNITUDES[match[3].toLowerCase()] : 1;

    return { value: Math.round(amount * scale), currency, asOf: this.year(text) };
  }

  /** "83,000 (2026)" -> { value, asOf } */
  parseCount(raw) {
    const text = this.clean(raw);
    const match = /([\d][\d,]*)/.exec(text);
    if (!match) return null;

    const value = Number(match[1].replace(/,/g, ''));
    if (!Number.isFinite(value) || value <= 0) return null;

    // A field left holding nothing but a year would otherwise read as a
    // headcount. Real counts of that size are written with a separator.
    if (!match[1].includes(',') && value >= 1900 && value <= 2100) return null;

    const asOf = this.year(text);
    return { value, asOf };
  }

  // ---- fetching -----------------------------------------------------------

  /**
   * Just the company infobox, cut out of the article by brace counting.
   *
   * Field names are not unique to it - every `{{cite web}}` in the article
   * carries its own `website=`, and the first one in the page is usually a
   * citation rather than the company's homepage. So the search is scoped to the
   * template body, and the citations hanging off its own fields are dropped:
   * a `<ref>` attached to the revenue figure contains a full `{{cite web}}`,
   * whose `website=` would otherwise be read as the company's homepage.
   */
  infobox(wikitext) {
    const start = /\{\{\s*Infobox\s+company/i.exec(wikitext);
    if (!start) return null;

    const strip = body => body
      .replace(/<ref[^>]*\/>/gi, '')
      .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');

    let depth = 0;
    for (let i = start.index; i < wikitext.length - 1; i++) {
      if (wikitext[i] === '{' && wikitext[i + 1] === '{') {
        depth++;
        i++;
      } else if (wikitext[i] === '}' && wikitext[i + 1] === '}') {
        depth--;
        i++;
        if (depth === 0) return strip(wikitext.slice(start.index, i + 1));
      }
    }

    // Unbalanced markup - take what is there rather than nothing
    return strip(wikitext.slice(start.index));
  }

  /** The raw value of one infobox field, before any cleanup. */
  field(infobox, name) {
    // Stop at the next parameter or the end of the template, not the next
    // newline: revenue often wraps onto a second line inside its citation
    const match = new RegExp(`\\|\\s*${name}\\s*=([\\s\\S]*?)(?=\\n\\s*\\||\\n\\}\\})`, 'i')
      .exec(infobox || '');
    return match ? match[1] : null;
  }

  /**
   * The homepage, as an absolute URL.
   *
   * The field holds anything from a bare "sc.com" to {{URL|https://x.com}} to
   * {{official URL}}, which renders from Wikidata and leaves nothing behind
   * once templates are flattened - in that case there is no answer here and the
   * Wikidata lookup supplies it instead.
   */
  parseWebsite(raw) {
    const text = this.clean(raw).split(/\s+/)[0] || '';
    // A hostname, optionally with a scheme and path, and nothing that looks
    // like leftover prose
    if (!/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(text)) return null;

    return /^https?:\/\//i.test(text) ? text : `https://${text}`;
  }

  /**
   * @returns {Promise<object|null>} whatever the infobox states, or null when
   *   the article states nothing useful.
   *
   * Throws when the lookup could not be completed. "Wikipedia was throttling
   * us" and "this article has no numbers in it" are different answers, and
   * only the second one is safe for a caller to remember.
   */
  async fetch(companyName) {
    if (!companyName) return null;

    const data = await this.request({
      action: 'query',
      titles: companyName,
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      redirects: 1,
      formatversion: 2,
    });

    const page = data.query?.pages?.[0];
    const wikitext = page?.revisions?.[0]?.slots?.main?.content;
    if (!wikitext || page.missing) return null;

    // Without a company infobox this is the wrong kind of article, and its
    // "revenue" field - if any - is about something else entirely
    const infobox = this.infobox(wikitext);
    if (!infobox) return null;

    const revenue = this.parseAmount(this.field(infobox, 'revenue'));
    const employees = this.parseCount(this.field(infobox, 'num_employees'));
    const industry = this.clean(this.field(infobox, 'industry'))
      // The field is often a list; the first entry is the primary industry
      .split(/[,;]|\s{2,}/)[0]
      .trim();

    const facts = {
      revenue: revenue?.value,
      revenueCurrency: revenue?.currency || undefined,
      revenueAsOf: revenue?.asOf || undefined,
      employees: employees?.value,
      employeesAsOf: employees?.asOf || undefined,
      industry: industry || undefined,
      website: this.parseWebsite(this.field(infobox, 'website')) || undefined,
      source: 'Wikipedia infobox',
    };

    if (!facts.revenue && !facts.employees && !facts.website) return null;

    console.log(
      `📘 Wikipedia infobox for ${companyName}: ` +
      `${facts.revenue ? `${facts.revenueCurrency || ''}${facts.revenue} revenue` : 'no revenue'}, ` +
      `${facts.employees ? `${facts.employees} staff` : 'no headcount'}`
    );

    return facts;
  }
}

module.exports = new InfoboxFetcher();
