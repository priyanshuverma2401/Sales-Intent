const axios = require('axios');
const infoboxFetcher = require('./infoboxFetcher');

/**
 * Firmographics — headcount, headquarters, revenue, industry, founding year.
 *
 * None of the other fetchers carry these. Wikipedia returns prose, Finnhub's
 * profile has industry/country but no headcount or address, and Yahoo's open
 * chart endpoint is prices only. Crunchbase would cover it but is key-gated and
 * off for most installs, so the report cover was left with an empty Fast Facts
 * block for every account.
 *
 * Wikidata answers all of it, needs no key, and covers non-US listings (the ones
 * SEC EDGAR never will). Every value carries a Q-item behind it, so the numbers
 * are attributable rather than guessed at by the model.
 */

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';

// Wikidata rejects requests without a descriptive User-Agent
const HEADERS = {
  'User-Agent': 'SalesMotion/1.0 (sales intelligence platform)',
};

// Named so the extraction below reads as prose rather than property numbers
const P = {
  logo: 'P154',
  headquarters: 'P159',
  country: 'P17',
  employees: 'P1128',
  revenue: 'P2139',
  industry: 'P452',
  inception: 'P571',
  website: 'P856',
  ticker: 'P249',
  exchange: 'P414',
  pointInTime: 'P585',
  endTime: 'P582',
};

// Wikidata states amounts in a currency item, not an ISO code. Only the ones a
// prospect's revenue is realistically reported in; anything else falls through
// to the label Wikidata already gave us.
const CURRENCY_CODES = {
  'united states dollar': 'USD',
  euro: 'EUR',
  'pound sterling': 'GBP',
  'japanese yen': 'JPY',
  'indian rupee': 'INR',
  'swiss franc': 'CHF',
  'canadian dollar': 'CAD',
  'australian dollar': 'AUD',
  'renminbi': 'CNY',
  'chinese yuan': 'CNY',
  'hong kong dollar': 'HKD',
  'singapore dollar': 'SGD',
  'south korean won': 'KRW',
  'swedish krona': 'SEK',
  'norwegian krone': 'NOK',
  'danish krone': 'DKK',
  'brazilian real': 'BRL',
  'mexican peso': 'MXN',
  'south african rand': 'ZAR',
  'new taiwan dollar': 'TWD',
};

class FirmographicsFetcher {
  // ---- low-level Wikidata access -----------------------------------------

  /**
   * One call against the API, retried once if the anonymous quota is hit.
   * A report needs three of these back to back and Wikidata throttles bursts,
   * so a single 429 should not cost the whole lookup.
   */
  async request(params, timeout = 10000) {
    for (let attempt = 0; ; attempt++) {
      try {
        const { data } = await axios.get(WIKIDATA_API, {
          params: { ...params, format: 'json' },
          headers: HEADERS,
          timeout,
        });
        return data;
      } catch (error) {
        if (attempt >= 1 || error.response?.status !== 429) throw error;
        const wait = Number(error.response.headers?.['retry-after']) * 1000 || 1200;
        await new Promise(resolve => setTimeout(resolve, Math.min(wait, 5000)));
      }
    }
  }

  async search(name) {
    const data = await this.request({
      action: 'wbsearchentities',
      search: name,
      language: 'en',
      uselang: 'en',
      type: 'item',
      limit: 5,
    }, 8000);

    return (data.search || []).map(hit => hit.id).filter(Boolean);
  }

  async entities(ids, props) {
    if (!ids.length) return {};

    const data = await this.request({
      action: 'wbgetentities',
      ids: ids.slice(0, 50).join('|'),
      props,
      languages: 'en',
    });

    return data.entities || {};
  }

  // ---- claim reading ------------------------------------------------------

  /** The year on a claim's point-in-time qualifier, or null when undated. */
  claimYear(claim) {
    const time = claim.qualifiers?.[P.pointInTime]?.[0]?.datavalue?.value?.time;
    const year = /^[+-](\d{4})/.exec(time || '');
    return year ? Number(year[1]) : null;
  }

  /**
   * The one claim worth reading out of a property's history.
   *
   * Wikidata keeps every figure a company ever reported, so P1128 alone can hold
   * a decade of headcounts. Preferred rank wins when an editor has marked a
   * current value; otherwise the most recent year does.
   *
   * `undatedWins` splits the two kinds of property. An undated headcount is the
   * present one, so it should beat a figure stamped 2019. An undated revenue is
   * just a figure with its period lost, and a dated one is strictly better.
   */
  best(claims = [], { undatedWins = false } = {}) {
    const usable = claims.filter(c => c.rank !== 'deprecated' && c.mainsnak?.datavalue);
    if (!usable.length) return null;

    const preferred = usable.filter(c => c.rank === 'preferred');
    const pool = preferred.length ? preferred : usable;

    // Undated sorts either above every year or below all of them
    const rank = claim => this.claimYear(claim) ?? (undatedWins ? Infinity : -Infinity);

    return pool.reduce((winner, claim) => (rank(claim) > rank(winner) ? claim : winner));
  }

  /** A claim that has not been superseded — no end-time qualifier on it. */
  current(claims = []) {
    const live = claims.filter(c => c.rank !== 'deprecated' && !c.qualifiers?.[P.endTime]);
    return this.best(live.length ? live : claims, { undatedWins: true });
  }

  itemId(claim) {
    return claim?.mainsnak?.datavalue?.value?.id || null;
  }

  /**
   * A Commons filename turned into an image URL.
   *
   * Wikidata stores the logo as a bare filename ("Infosys logo.svg"). FilePath
   * resolves it, and asking for a width rasterises the SVG most company logos
   * are stored as - browsers would handle the SVG, but pdfkit would not.
   */
  commonsImage(fileName, width = 256) {
    if (!fileName || typeof fileName !== 'string') return undefined;

    const file = encodeURIComponent(fileName.replace(/ /g, '_'));
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${file}?width=${width}`;
  }

  /** Every ticker symbol on the entity, including the ones hung off exchanges. */
  tickers(entity) {
    const claims = entity.claims || {};
    const direct = (claims[P.ticker] || []).map(c => c.mainsnak?.datavalue?.value);
    const onExchange = (claims[P.exchange] || []).flatMap(c =>
      (c.qualifiers?.[P.ticker] || []).map(q => q.datavalue?.value)
    );

    return [...direct, ...onExchange]
      .filter(Boolean)
      .map(symbol => String(symbol).toUpperCase());
  }

  /**
   * How much this candidate looks like the company we asked about.
   *
   * A bare name search for "Apple" returns the fruit, the record label and the
   * borough before the manufacturer, so the first hit cannot simply be taken.
   * A matching ticker settles it outright; failing that, the candidate carrying
   * the most company-shaped properties wins.
   */
  score(entity, ticker) {
    const claims = entity.claims || {};

    let score = [P.headquarters, P.industry, P.employees, P.revenue, P.website, P.exchange]
      .filter(property => claims[property]?.length).length;

    if (ticker && this.tickers(entity).includes(String(ticker).toUpperCase())) score += 10;

    return score;
  }

  // ---- main entry point ---------------------------------------------------

  /**
   * @returns {Promise<object|null>} firmographics from Wikidata and the
   *   Wikipedia infobox, merged, or null when neither source knows this
   *   company. Either source alone is still worth putting on the cover, so one
   *   of the two failing is not fatal.
   *
   * Throws only when *both* lookups failed to complete. A caller that cannot
   * tell "no public record exists" from "both APIs were throttling us" will
   * cache the throttling as an answer - which is exactly how an account ends up
   * with a permanently blank cover.
   */
  async fetch(companyName, ticker) {
    if (!companyName) return null;

    const [wikidata, infobox] = await Promise.allSettled([
      this.fromWikidata(companyName, ticker),
      infoboxFetcher.fetch(companyName),
    ]);

    if (wikidata.status === 'rejected' && infobox.status === 'rejected') {
      console.error(`❌ Firmographics lookup failed for ${companyName}: ${wikidata.reason?.message}`);
      throw wikidata.reason;
    }

    for (const [source, result] of [['Wikidata', wikidata], ['Wikipedia infobox', infobox]]) {
      if (result.status === 'rejected') {
        console.warn(`⚠️ ${source} unavailable for ${companyName}: ${result.reason?.message}`);
      }
    }

    return this.merge(
      wikidata.status === 'fulfilled' ? wikidata.value : null,
      infobox.status === 'fulfilled' ? infobox.value : null
    );
  }

  /**
   * Combine the two sources.
   *
   * Wikidata owns the location fields - they are proper entities there, against
   * an infobox address written as free text. The two figures that go stale,
   * headcount and revenue, go to whichever source states the later year, since
   * a 2026 headcount from the article beats a 2022 one from Wikidata whatever
   * its rank says.
   */
  merge(wikidata, infobox) {
    if (!wikidata) return infobox;
    if (!infobox) return wikidata;

    const fresher = (field, asOfField) => {
      const a = wikidata[field];
      const b = infobox[field];
      if (a === undefined) return 'infobox';
      if (b === undefined) return 'wikidata';
      return (infobox[asOfField] || 0) > (wikidata[asOfField] || 0) ? 'infobox' : 'wikidata';
    };

    const employeesFrom = fresher('employees', 'employeesAsOf') === 'infobox' ? infobox : wikidata;
    const revenueFrom = fresher('revenue', 'revenueAsOf') === 'infobox' ? infobox : wikidata;

    return {
      ...wikidata,
      employees: employeesFrom.employees,
      employeesAsOf: employeesFrom.employeesAsOf,
      revenue: revenueFrom.revenue,
      revenueCurrency: revenueFrom.revenueCurrency,
      revenueAsOf: revenueFrom.revenueAsOf,
      industry: wikidata.industry || infobox.industry,
      // {{official URL}} in the infobox renders from Wikidata anyway, so that is
      // the one to trust when both state a homepage
      website: wikidata.website || infobox.website,
      source: [wikidata.source, infobox.source].filter(Boolean).join(' + '),
    };
  }

  /** Throws when the lookup fails; resolves null when nothing matches. */
  async fromWikidata(companyName, ticker) {
    const candidateIds = await this.search(companyName);
    if (!candidateIds.length) return null;

    const candidates = await this.entities(candidateIds, 'claims');

    let entity = null;
    let bestScore = 0;
    for (const candidate of Object.values(candidates)) {
      const score = this.score(candidate, ticker);
      if (score > bestScore) {
        bestScore = score;
        entity = candidate;
      }
    }

    // Two company-shaped properties is the floor. Below that the match is a
    // guess, and a wrong headcount on the cover is worse than a blank one.
    if (!entity || bestScore < 2) {
      console.log(`ℹ️ No confident Wikidata match for ${companyName}`);
      return null;
    }

    return await this.extract(entity, companyName);
  }

  async extract(entity, companyName) {
    const claims = entity.claims || {};

    const hqClaim = this.current(claims[P.headquarters]);
    const employeeClaim = this.best(claims[P.employees], { undatedWins: true });
    const revenueClaim = this.best(claims[P.revenue]);
    const industryIds = (claims[P.industry] || [])
      .filter(c => c.rank !== 'deprecated')
      .map(c => this.itemId(c))
      .filter(Boolean);

    // Amounts arrive as a unit entity URI rather than a currency code
    const revenueUnit = revenueClaim?.mainsnak?.datavalue?.value?.unit || '';
    const currencyId = /entity\/(Q\d+)$/.exec(revenueUnit)?.[1] || null;

    // The city on the headquarters claim carries its own country qualifier;
    // the entity-level one is the fallback for a bare "located in X".
    const hqCountryId = hqClaim?.qualifiers?.[P.country]?.[0]?.datavalue?.value?.id
      || this.itemId(claims[P.country]?.[0]);

    // One round trip resolves every Q-item the answer refers to
    const referenced = [
      this.itemId(hqClaim),
      hqCountryId,
      currencyId,
      ...industryIds.slice(0, 3),
    ].filter(Boolean);

    const labels = await this.labelsFor([...new Set(referenced)]);

    const city = labels[this.itemId(hqClaim)] || null;
    const country = labels[hqCountryId] || null;

    const industry = industryIds
      .map(id => labels[id])
      .filter(Boolean)
      .map(label => label.charAt(0).toUpperCase() + label.slice(1))[0] || null;

    const revenueAmount = Number(revenueClaim?.mainsnak?.datavalue?.value?.amount);
    const currencyLabel = currencyId ? labels[currencyId] : null;

    const inception = this.best(claims[P.inception]);
    const foundedYear = /^[+-](\d{4})/.exec(
      inception?.mainsnak?.datavalue?.value?.time || ''
    )?.[1];

    const employees = Number(employeeClaim?.mainsnak?.datavalue?.value?.amount);

    const facts = {
      city,
      country,
      headquarters: [city, country].filter(Boolean).join(', ') || null,
      employees: Number.isFinite(employees) && employees > 0 ? Math.round(employees) : undefined,
      employeesAsOf: employeeClaim ? this.claimYear(employeeClaim) ?? undefined : undefined,
      revenue: Number.isFinite(revenueAmount) && revenueAmount > 0 ? revenueAmount : undefined,
      revenueCurrency: currencyLabel
        ? CURRENCY_CODES[currencyLabel.toLowerCase()] || currencyLabel
        : undefined,
      revenueAsOf: revenueClaim ? this.claimYear(revenueClaim) ?? undefined : undefined,
      industry: industry || undefined,
      foundedYear: foundedYear ? Number(foundedYear) : undefined,
      website: this.best(claims[P.website])?.mainsnak?.datavalue?.value || undefined,
      logoUrl: this.commonsImage(this.best(claims[P.logo])?.mainsnak?.datavalue?.value),
      wikidataId: entity.id,
      source: 'Wikidata',
    };

    console.log(
      `🏛️ Wikidata ${entity.id} for ${companyName}: ` +
      `${facts.headquarters || 'no HQ'}, ${facts.employees ? `${facts.employees} staff` : 'no headcount'}` +
      `${facts.revenue ? `, revenue ${facts.revenue}` : ''}`
    );

    return facts;
  }

  async labelsFor(ids) {
    if (!ids.length) return {};

    const entities = await this.entities(ids, 'labels');
    const labels = {};

    for (const [id, entity] of Object.entries(entities)) {
      const label = entity.labels?.en?.value;
      if (label) labels[id] = label;
    }

    return labels;
  }
}

module.exports = new FirmographicsFetcher();
