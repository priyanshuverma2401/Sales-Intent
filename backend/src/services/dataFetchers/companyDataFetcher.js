const axios = require('axios');
const financialDataFetcher = require('./financialDataFetcher');
const firmographicsFetcher = require('./firmographicsFetcher');

// Wikipedia's API rejects requests without a descriptive User-Agent
const WIKI_HEADERS = {
  'User-Agent': 'SalesMotion/1.0 (sales intelligence platform)',
};

// The logo Wikidata names as the logo, shown next to each suggestion so the
// right Microsoft is recognisable before it is picked
const LOGO_PROPERTY = 'P154';

/**
 * What an article has to have on Wikidata before it can be an account.
 *
 * Wikipedia's full-text search ranks by article relevance, not by whether the
 * thing is a company: "infosys" returns Nandan Nilekani and the Infosys Prize,
 * "zoho" returns the Zoho disambiguation page and Zoho Office Suite. None of
 * those are something a rep can pitch into.
 *
 * Rather than guess from the title or the description prose, a suggestion is
 * kept when Wikidata records something only an organisation has. Listing the
 * properties an organisation carries generalises better than trying to
 * enumerate the classes one can be an instance of - there are hundreds of those
 * (business, public company, bank, retail chain, university...) and the list is
 * never finished.
 */
const ORGANISATION_CLAIMS = [
  'P159',  // headquarters location
  'P452',  // industry
  'P1128', // employees
  'P2139', // revenue
  'P414',  // stock exchange
  'P249',  // ticker symbol
  'P1454', // legal form
  'P169',  // chief executive officer
  'P355',  // has subsidiary
  'P740',  // location of formation
];

// Industry is the one property above that a product states as readily as the
// company that makes it, so it is left out when the two have to be told apart
const STRONG_ORGANISATION_CLAIMS = ORGANISATION_CLAIMS.filter(property => property !== 'P452');

/**
 * Properties only a *work* carries - software, a film, a book, an album.
 *
 * Enumerating the classes a product can be an instance of is hopeless: Windows
 * is filed under four of them and Excel under two, none shared. What they do
 * share is that something made them - a developer, a version, a licence - and
 * no company has any of that. A search for "microsoft" returns Windows, Excel
 * and the Microsoft Store above most real subsidiaries, so this is what keeps
 * them out of the account list.
 */
const PRODUCT_CLAIMS = [
  'P400',  // platform
  'P275',  // copyright licence
  'P57',   // director
  'P50',   // author
  'P86',   // composer
  'P123',  // publisher
];

/**
 * The properties that settle it on their own.
 *
 * Nothing that was built by someone, ships versions or runs on an operating
 * system is a company, whatever else its item happens to state. Salesforce
 * Marketing Cloud carries a headquarters and a stock exchange inherited from
 * Salesforce itself, so only its developer tells the two apart.
 */
const DECISIVE_PRODUCT_CLAIMS = [
  'P178',  // developer
  'P348',  // software version identifier
  'P306',  // operating system
  'P277',  // programming language
];

/**
 * Classes that disqualify an article outright, even when it does carry one of
 * the claims above. A founder inherits their company's industry often enough
 * that the properties alone would let a person through.
 */
/**
 * Recently answered searches, so the box does not re-ask Wikidata for a query
 * it just resolved.
 *
 * Typing "microsoft" is one request per debounce and every rep in the tenant
 * hits the same handful of prospects. Without this the anonymous quota is spent
 * on repeats, and a throttled lookup is what puts a founder and a prize in the
 * suggestion list instead of the company.
 */
const SUGGESTION_TTL_MS = 10 * 60 * 1000;
const SUGGESTION_CACHE_MAX = 300;
const suggestionCache = new Map();

const NEVER_AN_ACCOUNT = new Set([
  'Q5',        // human
  'Q4167410',  // disambiguation page
  'Q4167836',  // category
  'Q13406463', // list article
  'Q101352',   // family name
  'Q202444',   // given name
  'Q618779',   // award
  'Q7397',     // software
  'Q11424',    // film
  'Q7889',     // video game
  'Q571',      // book
  // Places, because a company name is often a place name too - searching
  // "zoho" turns up the Slovak village of Zohor and its railway station
  'Q532',      // village
  'Q3957',     // town
  'Q515',      // city
  'Q486972',   // human settlement
  'Q55488',    // railway station
  'Q928830',   // metro station
]);

/**
 * The exchanges a ticker is worth carrying from.
 *
 * Wikidata lists every listing a company has, including local scrip codes -
 * Infosys comes back as "500209", its Bombay Stock Exchange number. Handing
 * that to the market feeds returns nothing, and it would still be printed on
 * the report cover as the company's symbol. The feeds behind this product cover
 * US listings, so that is the only listing taken.
 */
const US_EXCHANGES = new Set([
  'Q13677',    // New York Stock Exchange
  'Q82059',    // Nasdaq
  'Q846626',   // NYSE American
]);

class CompanyDataFetcher {
  // Fetch from Wikipedia API
  async fetchFromWikipedia(companyName) {
    try {
      const response = await axios.get('https://en.wikipedia.org/w/api.php', {
        params: {
          action: 'query',
          titles: companyName,
          prop: 'extracts|pageimages',
          exintro: true,
          explaintext: true,
          format: 'json',
          pithumbsize: 250,
        },
        headers: WIKI_HEADERS,
        timeout: 8000,
      });

      const pages = response.data.query.pages;
      const page = Object.values(pages)[0];

      if (page.extract) {
        return {
          description: page.extract,
          // The article's lead image, which is the logo for some companies and
          // a photo of a campus or a founder for others - Infosys returns
          // "Infosys_(4911287704).jpg", a picture of a building. Kept only as a
          // last resort behind the sources that state a logo explicitly.
          pageImage: page.thumbnail?.source,
          source: 'Wikipedia',
        };
      }
    } catch (error) {
      console.error('❌ Wikipedia error:', error.message);
    }

    return null;
  }

  // Fetch from Crunchbase API (limited free tier)
  async fetchFromCrunchbase(companyName) {
    if (!process.env.CRUNCHBASE_API_KEY) {
      return null;
    }

    try {
      const response = await axios.get('https://api.crunchbase.com/api/v4/entities/organizations', {
        params: {
          name: companyName,
          user_key: process.env.CRUNCHBASE_API_KEY,
        },
        timeout: 8000,
      });

      if (response.data.entities?.[0]) {
        const company = response.data.entities[0];
        return {
          website: company.website_url,
          industry: company.primary_role,
          foundedYear: company.founded_on ? new Date(company.founded_on).getFullYear() : undefined,
          employees: company.num_employees_max,
          description: company.short_description,
          source: 'Crunchbase',
        };
      }
    } catch (error) {
      console.error('❌ Crunchbase error:', error.message);
    }

    return null;
  }

  // Fetch company info from multiple sources
  async fetchCompanyInfo(companyName, ticker, { wikidataId } = {}) {
    console.log(`🏢 Fetching company info for ${companyName}`);

    let companyInfo = {
      name: companyName,
      ticker,
    };

    const [wikipediaData, crunchbaseData, firmographics, fundamentals] = await Promise.all([
      this.fetchFromWikipedia(companyName),
      this.fetchFromCrunchbase(companyName),
      // Headcount, headquarters city and revenue come from nowhere else on a
      // keyless install, and the report cover is built out of exactly those.
      // A failure here must not sink the whole enrichment - `backfill` retries
      // it when the report is generated.
      firmographicsFetcher.fetch(companyName, ticker, { wikidataId }).catch(error => {
        console.warn(`⚠️ Firmographics unavailable for ${companyName}: ${error.message}`);
        return null;
      }),
      // Finnhub carries industry / website / logo / country, which Wikipedia's
      // extract does not. Without this the stored company had a blank industry.
      ticker ? financialDataFetcher.getCompanyFundamentals(ticker) : Promise.resolve(null),
    ]);

    if (wikipediaData) companyInfo = { ...companyInfo, ...wikipediaData };
    if (crunchbaseData) companyInfo = { ...companyInfo, ...crunchbaseData };

    if (firmographics) {
      // Wikidata is the only source for these, so it does not have to compete
      for (const key of ['city', 'country', 'employees', 'revenue', 'revenueCurrency', 'revenueAsOf', 'foundedYear']) {
        if (companyInfo[key] === undefined && firmographics[key] !== undefined && firmographics[key] !== null) {
          companyInfo[key] = firmographics[key];
        }
      }
      // Finnhub's industry ("Banking") reads better than Wikidata's item label
      // ("economics of banking"), so this only fills a gap
      if (!companyInfo.industry && firmographics.industry) companyInfo.industry = firmographics.industry;
      if (!companyInfo.website && firmographics.website) companyInfo.website = firmographics.website;

      // The company's own LinkedIn and Crunchbase pages. Wikidata is the only
      // source here - no other fetcher states an identifier for either site.
      companyInfo.profiles = firmographics.profiles;
      companyInfo.wikidataId = firmographics.wikidataId;
    }

    if (fundamentals) {
      // Only fill gaps - never clobber a richer Wikipedia/Crunchbase value
      for (const key of ['industry', 'website', 'country']) {
        if (!companyInfo[key] && fundamentals[key]) companyInfo[key] = fundamentals[key];
      }
      if (!companyInfo.ticker) companyInfo.ticker = fundamentals.ticker;
    }

    // Sources that state "this is the logo" come first. The article's lead image
    // is a guess at one and is only better than showing nothing.
    companyInfo.logo =
      firmographics?.logoUrl || fundamentals?.logo || companyInfo.pageImage || undefined;
    delete companyInfo.pageImage;

    console.log('✅ Company info fetched');
    return companyInfo;
  }

  /**
   * Whether a stored logo is really the article's lead image.
   *
   * Wikipedia's pageimages endpoint serves from upload.wikimedia.org; a logo
   * named by Wikidata comes through Special:FilePath on commons.wikimedia.org,
   * and Finnhub's from its own host. So the host alone tells them apart.
   */
  isArticleImage(url) {
    return /upload\.wikimedia\.org/i.test(String(url || ''));
  }

  /**
   * Fill in firmographics an existing account is missing, in place.
   *
   * Enrichment used to run only at "Add account", so every company stored before
   * this fetcher existed - which is all of them - has no headcount, no city and
   * no revenue, and regenerating the report would have reproduced the same empty
   * cover. Report generation calls this so a rerun repairs the record.
   *
   * @param {object} [options]
   * @param {boolean} [options.force] look again even if a recent lookup found
   *   nothing - what "Refresh" is for
   * @returns {Promise<boolean>} whether anything was actually filled in
   */
  async backfill(company, { force = false } = {}) {
    if (!company) return false;

    const needsRevenue = !company.financials?.revenue;
    const needsLogo = !company.logoUrl || this.isArticleImage(company.logoUrl);
    // Every account stored before profile links existed has none, so this is
    // what turns the report's LinkedIn and Crunchbase entries from a search
    // page into the company's own page on a rerun
    const needsProfiles = !company.profiles?.linkedin || !company.profiles?.crunchbase;
    const missing =
      !company.city || needsRevenue || needsLogo || needsProfiles || !company.employees ||
      !company.industry || !company.foundedYear || !company.country || company.country === 'Unknown';

    if (!missing) return false;

    // Plenty of private accounts have no public record at all. Without this,
    // every regenerated report would pay for the same three lookups and get the
    // same nothing back.
    //
    // Only a lookup that found *nothing* is held off, though. An account whose
    // record was found but is thin gets looked at again, because what is thin
    // changes: every account added before profile links existed was filled in
    // successfully and still has no LinkedIn page, and waiting a week to notice
    // that is how a report keeps sending the rep to a search page.
    const wikidata = company.dataSources?.wikidata;
    const daysSince = wikidata?.lastFetched
      ? (Date.now() - new Date(wikidata.lastFetched)) / 86400000
      : Infinity;
    if (!force && wikidata?.status === 'empty' && daysSince < 7) return false;

    let facts;
    try {
      facts = await firmographicsFetcher.fetch(company.name, company.ticker, {
        wikidataId: company.wikidataId,
      });
    } catch (error) {
      // The lookup never completed - Wikidata and Wikipedia both throttle
      // bursts, and adding an account fires one. Recording that as "empty"
      // would start the cooldown below and leave the cover blank for a week
      // over what is usually a few seconds of rate limiting, so nothing is
      // written and the next report tries again.
      console.warn(`⚠️ Firmographics lookup did not complete for ${company.name}: ${error.message}`);
      return false;
    }

    // Record the attempt either way, so a miss is not retried on every report
    if (!company.dataSources) company.dataSources = {};
    company.dataSources.wikidata = {
      lastFetched: new Date(),
      status: facts ? 'success' : 'empty',
    };

    if (!facts) {
      await company.save();
      return false;
    }

    let changed = false;
    const fill = (field, value) => {
      if (value === undefined || value === null || value === '') return;
      if (company[field]) return;
      company[field] = value;
      changed = true;
    };

    fill('city', facts.city);
    fill('employees', facts.employees);
    fill('foundedYear', facts.foundedYear);
    fill('industry', facts.industry);
    fill('website', facts.website);
    fill('wikidataId', facts.wikidataId);

    for (const site of ['linkedin', 'crunchbase']) {
      if (facts.profiles?.[site] && !company.profiles?.[site]) {
        company.profiles = { ...(company.profiles?.toObject?.() ?? company.profiles ?? {}), [site]: facts.profiles[site] };
        changed = true;
      }
    }

    if ((!company.country || company.country === 'Unknown') && facts.country) {
      company.country = facts.country;
      changed = true;
    }

    // The one field that is overwritten rather than merely filled: accounts
    // added earlier stored the article's lead image, which for Infosys is a
    // photograph of the campus. A logo Wikidata names as the logo replaces it.
    if (needsLogo && facts.logoUrl) {
      company.logoUrl = facts.logoUrl;
      changed = true;
    }

    if (needsRevenue && facts.revenue) {
      // Assigning into the subdocument keeps the rest of financials intact
      company.financials = {
        ...(company.financials?.toObject?.() ?? company.financials ?? {}),
        revenue: facts.revenue,
        revenueCurrency: facts.revenueCurrency,
        revenueAsOf: facts.revenueAsOf,
      };
      changed = true;
    }

    if (changed) {
      company.updatedAt = new Date();
      console.log(`🧩 Backfilled firmographics for ${company.name}`);
    }

    await company.save();
    return changed;
  }

  // Get company logo
  async getCompanyLogo(companyName, ticker) {
    if (ticker) {
      const fundamentals = await financialDataFetcher.getCompanyFundamentals(ticker);
      if (fundamentals?.logo) return fundamentals.logo;
    }

    try {
      const response = await axios.get(
        `https://autocomplete.clearbit.com/v1/companies?query=${encodeURIComponent(companyName)}`,
        { timeout: 8000 }
      );

      if (response.data?.[0]?.logo) {
        return response.data[0].logo;
      }
    } catch (error) {
      console.error('❌ Logo fetch error:', error.message);
    }

    return null;
  }

  /**
   * Name suggestions for the "Add an account" box, each with its homepage and
   * logo.
   *
   * Two searches run, because neither answers on its own:
   *
   * - Wikidata matches the *name*, including every alias a company is filed
   *   under, so "zoho", "L&T" and "MSFT" resolve to the company itself. The
   *   article search cannot do this; it ranks by how much a page discusses the
   *   term, which is why "infosys" used to return Nandan Nilekani and the
   *   Infosys Prize, and why a company whose article is short returned nothing
   *   a rep could pick.
   * - Wikipedia's full-text search covers the reverse case, where the name
   *   people type is not the registered one ("Google" is filed as "Google LLC")
   *   or the company has no Wikidata label in English at all.
   *
   * The two lists are merged on Wikidata id, then one batched Wikidata call
   * says, for every candidate at once, whether it is an organisation, where its
   * homepage is and what its logo is. Anything that is a person, a product, a
   * film or a disambiguation page is dropped; the rest are ranked by how
   * closely the name matches what was typed.
   */
  async searchCompanies(query) {
    const term = String(query || '').trim();
    if (!term) return [];

    const cached = this.cachedSuggestions(term);
    if (cached) return cached;

    console.log(`🔍 Searching for companies: ${term}`);

    const [byName, byArticle] = await Promise.all([
      firmographicsFetcher.suggest(term, 10).catch(error => {
        console.warn('⚠️ Wikidata name search failed:', error.message);
        return [];
      }),
      this.searchWikipedia(term).catch(error => {
        console.warn('⚠️ Wikipedia search failed:', error.message);
        return [];
      }),
    ]);

    // Name matches lead: they are the ones that are actually about the company
    const candidates = [];
    const seen = new Map();

    const add = candidate => {
      candidate.name = this.cleanName(candidate.name);
      if (!candidate.name) return;
      const key = candidate.wikidataId || candidate.name.toLowerCase();
      const existing = seen.get(key);
      if (existing) {
        // The article search carries a readable first sentence; the name search
        // carries only Wikidata's one-line description. Keep the better of each.
        if (!existing.snippet && candidate.snippet) existing.snippet = candidate.snippet;
        if (!existing.wikidataId) existing.wikidataId = candidate.wikidataId;
        return;
      }
      seen.set(key, candidate);
      candidates.push(candidate);
    };

    byName.forEach((hit, index) =>
      add({
        name: hit.label,
        snippet: hit.description,
        wikidataId: hit.id,
        source: 'Wikidata',
        rank: index,
      })
    );
    byArticle.forEach((hit, index) =>
      add({ ...hit, rank: byName.length + index })
    );

    const results = (await this.describeCandidates(candidates, term)).slice(0, 6);

    console.log(`✅ Found ${results.length} companies`);
    // A run where both searches were throttled is not an answer worth keeping
    if (results.length) this.cacheSuggestions(term, results);

    return results;
  }

  cachedSuggestions(term) {
    const entry = suggestionCache.get(term.toLowerCase());
    if (!entry) return null;

    if (Date.now() - entry.at > SUGGESTION_TTL_MS) {
      suggestionCache.delete(term.toLowerCase());
      return null;
    }

    return entry.results;
  }

  cacheSuggestions(term, results) {
    // Insertion-ordered, so the first key is the oldest
    if (suggestionCache.size >= SUGGESTION_CACHE_MAX) {
      suggestionCache.delete(suggestionCache.keys().next().value);
    }
    suggestionCache.set(term.toLowerCase(), { at: Date.now(), results });
  }

  /** Full-text article search, each hit carrying its Wikidata id. */
  async searchWikipedia(query) {
    const response = await axios.get('https://en.wikipedia.org/w/api.php', {
      params: {
        action: 'query',
        generator: 'search',
        gsrsearch: query,
        gsrnamespace: 0,
        gsrlimit: 12,
        prop: 'extracts|pageprops',
        ppprop: 'wikibase_item',
        exintro: true,
        explaintext: true,
        exsentences: 1,
        format: 'json',
        formatversion: 2,
      },
      headers: WIKI_HEADERS,
      timeout: 8000,
    });

    return (response.data.query?.pages || [])
      // A generator returns pages in arbitrary order; index is the ranking
      .sort((a, b) => (a.index || 0) - (b.index || 0))
      .map(page => ({
        name: page.title,
        source: 'Wikipedia',
        snippet: String(page.extract || '').replace(/\s+/g, ' ').trim(),
        wikidataId: page.pageprops?.wikibase_item,
      }));
  }

  /**
   * Describe, filter and rank the merged candidates from one Wikidata call.
   *
   * When that call is the thing that fails - Wikidata throttles bursts and a
   * search box fires them - nothing is known about any candidate, so only the
   * ones whose name actually contains what was typed are offered. That is worse
   * than the filtered list but still answers the question, where showing the
   * article search raw would put a founder and a prize at the top of it.
   */
  async describeCandidates(candidates, term) {
    const ids = candidates.map(c => c.wikidataId).filter(Boolean);

    let entities = {};
    if (ids.length) {
      try {
        entities = await firmographicsFetcher.entities(ids, 'claims');
      } catch (error) {
        console.error('⚠️ Suggestion lookup failed:', error.message);
        return candidates
          .filter(c => this.mentions(c.name, term))
          .map(c => this.presentable(c))
          .slice(0, 6);
      }
    }

    const described = candidates.map(candidate => {
      const claims = entities[candidate.wikidataId]?.claims;
      if (!claims) {
        // An article Wikidata has nothing on is kept rather than guessed at -
        // a small private prospect is likelier than a false positive
        return { ...candidate, organisation: true, evidence: 0 };
      }

      const website = firmographicsFetcher.best(claims.P856)?.mainsnak?.datavalue?.value;
      const logo = firmographicsFetcher.best(claims[LOGO_PROPERTY])?.mainsnak?.datavalue?.value;
      const ticker = this.usTicker(claims);

      const domain = website ? this.hostname(website) : candidate.website;

      return {
        ...candidate,
        website: domain,
        // Commons is asked for a raster at roughly the size the row shows,
        // since most logos are stored there as SVG. Wikidata names a logo for
        // the large accounts and nothing for the rest, so a company that has a
        // homepage but no logo item falls back to that site's own icon.
        logoUrl: firmographicsFetcher.commonsImage(logo, 128) || this.faviconUrl(domain),
        ticker: ticker || candidate.ticker,
        excluded: this.isNeverAnAccount(claims) || this.isProduct(claims),
        organisation: this.isOrganisation(claims),
        evidence: ORGANISATION_CLAIMS.filter(property => claims[property]?.length).length,
      };
    });

    const byScore = (a, b) => this.suggestionScore(b, term) - this.suggestionScore(a, term);

    // People, products, films and disambiguation pages are never shown.
    //
    // An article search hit whose title does not contain what was typed is
    // dropped too: it ranked because the article *mentions* the term, which is
    // how a search for "zoho" used to return Freshworks. A Wikidata hit is kept
    // whatever its label reads, since it matched a name or an alias - that is
    // what turns "L&T" into Larsen & Toubro.
    const usable = described.filter(
      c => !c.excluded && (c.source !== 'Wikipedia' || this.mentions(c.name, term))
    );

    const companies = usable.filter(c => c.organisation).sort(byScore);

    // Everything else Wikidata knows nothing about - which is most private
    // prospects, and also every unrelated thing that happens to share the name.
    // Enough are kept to answer for a company nobody has written up, but they
    // never push a real match off the list.
    const unknown = usable
      .filter(c => !c.organisation)
      .sort(byScore)
      .slice(0, Math.max(0, 3 - companies.length));

    return [...companies, ...unknown].map(c => this.presentable(c));
  }

  /**
   * The label as a person would write it.
   *
   * Wikidata labels for companies written in more than one script carry bidi
   * marks - "HDFC Bank" comes back with a pop-directional-formatting character
   * on the end. Invisible in the suggestion list, but it becomes the stored
   * account name and then no lookup matches it again.
   */
  cleanName(name) {
    return String(name || '')
      // Zero-width spaces, bidi embeddings and overrides, and the BOM
      .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * The company's symbol on a US exchange, or nothing.
   *
   * A ticker is only offered when Wikidata says which exchange it belongs to
   * and that exchange is one the market feeds cover - an unqualified symbol is
   * as likely to be a local scrip code as a symbol.
   */
  usTicker(claims) {
    const symbols = (claims.P414 || [])
      .filter(claim => US_EXCHANGES.has(claim.mainsnak?.datavalue?.value?.id))
      .flatMap(claim => (claim.qualifiers?.P249 || []).map(q => q.datavalue?.value))
      .filter(symbol => typeof symbol === 'string');

    const symbol = symbols[0]?.trim().toUpperCase();
    // Symbols are short and start with a letter; anything else is an identifier
    // that happens to be filed under the same property
    return symbol && /^[A-Z][A-Z.\-]{0,5}$/.test(symbol) ? symbol : undefined;
  }

  /** Whether a name contains what was typed, as a word rather than a substring. */
  mentions(name, term) {
    const typed = String(term || '').trim().toLowerCase();
    if (!typed) return true;

    const escaped = typed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|\\W)${escaped}`, 'i').test(String(name || ''));
  }

  /** How well a candidate answers what was typed. Higher wins. */
  suggestionScore(candidate, term) {
    const name = String(candidate.name || '').toLowerCase();
    const typed = String(term || '').toLowerCase();

    let score = 0;
    if (name === typed) score += 100;
    else if (name.startsWith(`${typed} `) || name.startsWith(`${typed},`)) score += 70;
    else if (name.startsWith(typed)) score += 55;
    else if (new RegExp(`\\b${typed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(name)) score += 30;

    // A company Wikidata knows six things about outranks one it knows two
    score += Math.min(candidate.evidence || 0, 8) * 4;
    // A homepage is the strongest sign the item is a going concern
    if (candidate.website) score += 6;
    // Ties fall back to the order the two searches returned
    score -= candidate.rank || 0;

    return score;
  }

  /** Strip the fields that only mattered while ranking. */
  presentable({ excluded, organisation, evidence, rank, ...candidate }) {
    return candidate;
  }

  /** Whether a Wikidata item is something that can never be an account. */
  isNeverAnAccount(claims) {
    return (claims.P31 || [])
      .map(claim => claim.mainsnak?.datavalue?.value?.id)
      .filter(Boolean)
      .some(id => NEVER_AN_ACCOUNT.has(id));
  }

  /** Whether a Wikidata item is a work rather than the company behind it. */
  isProduct(claims) {
    if (DECISIVE_PRODUCT_CLAIMS.some(property => claims[property]?.length)) return true;

    // Past those, a company that publishes is stated the other way round (P123
    // points *at* the publisher), so an item that is staffed, headquartered or
    // listed is taken as the company.
    //
    // Industry is deliberately not counted as one of those: a browser states an
    // industry the same way its maker does, and it is the property that let
    // every office suite through as an account.
    if (STRONG_ORGANISATION_CLAIMS.some(property => claims[property]?.length)) return false;

    return PRODUCT_CLAIMS.some(property => claims[property]?.length);
  }

  /** Whether a Wikidata item's claims describe an organisation. */
  isOrganisation(claims) {
    if (this.isNeverAnAccount(claims)) return false;

    return ORGANISATION_CLAIMS.some(property => claims[property]?.length);
  }

  /**
   * A site's own icon, for suggestions Wikidata has no logo item for.
   *
   * Only ever used for display in the search box - it is never stored as the
   * company's logo, which the report cover prints at a size no favicon holds up
   * at.
   */
  faviconUrl(domain) {
    if (!domain) return undefined;
    return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`;
  }

  hostname(url) {
    return String(url || '')
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/$/, '')
      .split('/')[0];
  }
}

module.exports = new CompanyDataFetcher();
