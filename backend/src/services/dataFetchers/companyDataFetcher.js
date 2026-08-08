const axios = require('axios');
const financialDataFetcher = require('./financialDataFetcher');
const firmographicsFetcher = require('./firmographicsFetcher');
const logoDevFetcher = require('./logoDevFetcher');
const brandfetchFetcher = require('./brandfetchFetcher');

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
 * Properties nothing but an incorporated company carries.
 *
 * These settle the conflated items. Uber's Wikidata item is the company *and*
 * the app in one: it states a developer, a platform and "instance of software"
 * right next to its revenue, headcount and legal form - and the product rules
 * below would read the first half and throw the company out of its own search
 * results. Nothing that is merely software has employees, revenue, a CEO or a
 * legal form, so any of these wins outright.
 *
 * Stock exchange (P414) is deliberately absent: Salesforce Marketing Cloud
 * inherits its parent's listing, and it really is a product.
 */
const CORPORATE_CLAIMS = [
  'P1454', // legal form
  'P1128', // employees
  'P2139', // revenue
  'P169',  // chief executive officer
];

/**
 * How the company behind a work is stated on the work's own item.
 *
 * People search for what they know - "snapchat", not "Snap Inc." - and the
 * thing they typed is a product whose maker is the actual prospect. These
 * properties point from the one to the other.
 */
const MAKER_CLAIMS = [
  'P178',  // developer
  'P176',  // manufacturer
  'P123',  // publisher
  'P127',  // owned by
];

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
  // Places, because a company name is often a place name too - searching
  // "zoho" turns up the Slovak village of Zohor and its railway station
  'Q532',      // village
  'Q3957',     // town
  'Q515',      // city
  'Q486972',   // human settlement
  'Q55488',    // railway station
  'Q928830',   // metro station
  // Nature and works of art, which brand names collide with constantly -
  // "uber" is also a genus of gastropods, "snapchat" also a song
  'Q16521',    // taxon
  'Q7366',     // song
  'Q134556',   // single
  'Q105543609',// musical work/composition
  'Q2188189',  // musical work
]);

/**
 * Classes that mean "this is a work, not its maker" - unless the item also
 * carries corporate claims, because Wikidata conflates a company with its
 * flagship product often enough (Uber is filed as software) that the class
 * alone cannot be trusted to exclude.
 */
const WORK_CLASSES = new Set([
  'Q7397',     // software
  'Q11424',    // film
  'Q7889',     // video game
  'Q571',      // book
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
  async fetchCompanyInfo(companyName, ticker, { wikidataId, domain } = {}) {
    console.log(`🏢 Fetching company info for ${companyName}`);

    const homepage = logoDevFetcher.hostname(domain);

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
      firmographicsFetcher.fetch(companyName, ticker, { wikidataId, domain: homepage }).catch(error => {
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

    // The homepage the rep picked the account by. Kept as the fallback rather
    // than the winner, since Wikidata states the registered site and this is
    // whatever the brand index had - but a company with no public record at all
    // now has a website on its cover where it used to have a blank line.
    if (!companyInfo.website && homepage) companyInfo.website = `https://${homepage}`;

    // Brandfetch is asked last because it is asked by domain, and the domain is
    // only settled once the sources above have had their say. It is the only
    // one of them that answers for a private company, which is where every
    // "Headquartered in Unknown" on a cover comes from - so it fills whatever
    // is still blank rather than competing for what is already known.
    const brand = await brandfetchFetcher.brand(
      homepage || this.hostname(companyInfo.website)
    );

    if (brand) {
      for (const key of ['city', 'state', 'country', 'employees', 'foundedYear', 'industry', 'description', 'website']) {
        if (!companyInfo[key] && brand[key]) companyInfo[key] = brand[key];
      }

      // Wikidata's identifiers are curated, so they win where both know a
      // company - but Brandfetch reads the links off the company's own site,
      // which is the only source for the accounts Wikidata has never heard of
      companyInfo.profiles = {
        ...brand.profiles,
        ...Object.fromEntries(
          Object.entries(companyInfo.profiles || {}).filter(([, value]) => value)
        ),
      };
    }

    // Sources that state "this is the logo" come first: Wikidata names the mark
    // a company itself uses, then Brandfetch's own asset. The CDN links behind
    // them render something for any domain, and the article's lead image last -
    // for Infosys that is a photograph of the campus.
    const logoDomain = homepage || this.hostname(companyInfo.website);
    companyInfo.logo =
      firmographics?.logoUrl ||
      brand?.logoUrl ||
      logoDevFetcher.imageUrl(logoDomain, { size: 256 }) ||
      brandfetchFetcher.logoUrl(logoDomain, { size: 256, type: 'logo' }) ||
      fundamentals?.logo ||
      companyInfo.pageImage ||
      undefined;
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
        domain: company.website,
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

    // Asked whatever Wikidata said, and by domain rather than by name: an
    // account Wikidata has never heard of is exactly the one whose cover reads
    // "Headquartered in Unknown", and this is the source that answers for it.
    const brand = await brandfetchFetcher.brand(company.website || facts?.website);

    // Record the attempt either way, so a miss is not retried on every report
    if (!company.dataSources) company.dataSources = {};
    company.dataSources.wikidata = {
      lastFetched: new Date(),
      status: facts ? 'success' : 'empty',
    };

    if (!facts && !brand) {
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

    // Wikidata first on every field, Brandfetch behind it - one is curated and
    // attributable, the other is read off the company's own site. Where
    // Wikidata is silent, which for a private prospect is everywhere, whatever
    // Brandfetch knows is the only thing standing between the cover and a blank
    fill('city', facts?.city || brand?.city);
    fill('state', facts?.state || brand?.state);
    fill('employees', facts?.employees || brand?.employees);
    fill('foundedYear', facts?.foundedYear || brand?.foundedYear);
    fill('industry', facts?.industry || brand?.industry);
    fill('website', facts?.website || brand?.website);
    fill('description', brand?.description);
    fill('wikidataId', facts?.wikidataId);

    for (const site of ['linkedin', 'crunchbase']) {
      const url = facts?.profiles?.[site] || brand?.profiles?.[site];
      if (url && !company.profiles?.[site]) {
        company.profiles = { ...(company.profiles?.toObject?.() ?? company.profiles ?? {}), [site]: url };
        changed = true;
      }
    }

    const country = facts?.country || brand?.country;
    if ((!company.country || company.country === 'Unknown') && country) {
      company.country = country;
      changed = true;
    }

    // The one field that is overwritten rather than merely filled: accounts
    // added earlier stored the article's lead image, which for Infosys is a
    // photograph of the campus. A logo one of these sources names as *the*
    // logo replaces it.
    const namedLogo = facts?.logoUrl || brand?.logoUrl;
    if (needsLogo && namedLogo) {
      company.logoUrl = namedLogo;
      changed = true;
    }

    // Still nothing, but we know where the company lives on the web: the brand
    // CDNs render a mark for most domains, and it is what puts a logo on the
    // cover of every account with no logo item anywhere.
    if (!company.logoUrl || this.isArticleImage(company.logoUrl)) {
      const domain = this.hostname(company.website);
      const brandLogo =
        logoDevFetcher.imageUrl(domain, { size: 256 }) ||
        brandfetchFetcher.logoUrl(domain, { size: 256, type: 'logo' });
      if (brandLogo) {
        company.logoUrl = brandLogo;
        changed = true;
      }
    }

    if (needsRevenue && facts?.revenue) {
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
   * Several searches run, because none answers on its own:
   *
   * - The brand indexes - logo.dev and Brandfetch - carry the companies nobody
   *   wrote an encyclopedia article about, which is most of them, and are the
   *   only sources here that are *about* companies rather than about subjects.
   *   Between them they decide which real company the rep meant. Each is off
   *   until its key is set, and either one alone is enough.
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

    const [fromLogoDev, fromBrandfetch, byName, byArticle] = await Promise.all([
      logoDevFetcher.search(term),
      brandfetchFetcher.search(term),
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
        matchedText: hit.matchedText,
        source: 'Wikidata',
        rank: index,
      })
    );
    byArticle.forEach((hit, index) =>
      add({ ...hit, rank: byName.length + index })
    );

    // One list, logo.dev first where both indexes answer - they overlap
    // heavily, and the first to name a domain keeps it
    const brands = [...fromLogoDev, ...fromBrandfetch];

    const described = await this.describeCandidates(candidates, term);

    // Generous, because the brand indexes routinely return five or more real
    // companies sharing a name and the list scrolls. Nothing the brand index
    // returned is cut before this point.
    const results = this.mergeBrands(described, brands, term)
      .slice(0, 12)
      .map(c => this.presentable(c));

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
        return candidates.filter(c => this.mentions(c.name, term)).slice(0, 6);
      }
    }

    const described = candidates.map(candidate =>
      this.describeOne(candidate, entities[candidate.wikidataId]?.claims)
    );

    // The companies the matches point at but that do not share the name: the
    // maker behind a product ("snapchat" is an app, the account is Snap Inc.)
    // and the parent and subsidiaries of the best match ("uber" should also
    // offer the regional entities a rep actually sells into).
    described.push(...await this.relatedCandidates(described, entities, term));

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

    // Items Wikidata knows nothing about are how a small private prospect gets
    // found - but they are also the songs and usernames that share a brand's
    // name, so they only appear when no real company answered the query, and
    // are marked so a brand-search hit can displace them entirely.
    const filler = companies.length
      ? []
      : usable
          .filter(c => !c.organisation)
          .sort(byScore)
          .slice(0, 3)
          .map(c => ({ ...c, filler: true }));

    return [...companies, ...filler];
  }

  /**
   * The brand index answers first, in full, and in its own order.
   *
   * Every company it returns becomes a row. None of the filtering and ranking
   * below applies to them, because none of it is needed: an index of companies
   * asked for a company name has already answered the question, and each hit
   * carries the domain and the mark that make the row usable. Ranking them
   * against encyclopedia entries only ever moved the right answer down the list
   * or off it - a search for "noon" lost noon.com itself that way.
   *
   * An entry the encyclopedias also found - same domain - is folded into its
   * brand row rather than repeated, which is how the Wikidata id and ticker
   * survive to make the enrichment exact once the account is added.
   *
   * What the encyclopedias found on their own follows, still filtered: that is
   * where the museums, songs and gastropods come from.
   */
  mergeBrands(described, brands, term) {
    // First writer wins: describeCandidates hands these over best-first, and
    // more than one entity can name the same homepage - Wikidata carries two
    // items for Microsoft, and the thinner of the two is not the one to fold
    const byDomain = new Map();
    for (const candidate of described) {
      if (candidate.website && !byDomain.has(candidate.website)) {
        byDomain.set(candidate.website, candidate);
      }
    }

    const claimed = new Set();
    const rows = [];

    for (const brand of brands) {
      // The two indexes overlap heavily; the first to name a domain keeps it
      if (!brand.domain || claimed.has(brand.domain)) continue;
      claimed.add(brand.domain);

      const match = byDomain.get(brand.domain);

      rows.push({
        ...(match || {}),
        // The brand index states the name the company trades under, which is
        // the one a rep is looking for - Wikidata's label for the same company
        // can be a lowercased slug or a legal form nobody says out loud
        name: brand.name || match?.name,
        website: brand.domain,
        logoUrl:
          brand.logoUrl ||
          logoDevFetcher.imageUrl(brand.domain) ||
          brandfetchFetcher.logoUrl(brand.domain) ||
          match?.logoUrl,
        logoFallbackUrl: match?.logoUrl,
        source: 'brand-index',
        organisation: true,
      });
    }

    // One row per homepage. An encyclopedia entry for a domain a brand row
    // already covers is the same company said twice, and a second entry for a
    // domain another encyclopedia entry covers is usually a duplicate item.
    const rest = [];
    for (const candidate of described) {
      if (candidate.website && claimed.has(candidate.website)) continue;
      if (candidate.website) claimed.add(candidate.website);
      // The "might be a company" filler exists to answer a query nothing else
      // could. Once the brand index has answered, it is only noise.
      if (rows.length && candidate.filler) continue;
      rest.push(candidate);
    }

    return [...rows, ...this.branded(this.answersFirst(rest, term))];
  }

  /**
   * Every suggestion arrives with a homepage and a mark, or it does not arrive.
   *
   * The domain is what tells HDFC Bank from HDFC Life and the logo is what a
   * person recognises before they have read either name, so a row missing
   * them cannot be picked with any confidence - and a row that cannot be picked
   * with confidence is what produces a report about the wrong company.
   *
   * Both brand CDNs render a mark for any domain, so either leads once its key
   * is set. The next source in the chain becomes the fallback the browser tries
   * when the first turns out to have nothing for that domain - no single index
   * covers every company, and a row with a broken image is worse than a row
   * with the plainer of two logos.
   */
  branded(candidates) {
    return candidates
      .filter(candidate => candidate.website)
      .map(candidate => {
        const chain = [
          // A mark the brand index handed back addresses the exact record that
          // matched, so it leads the URLs built from the domain below
          candidate.source === 'brand-index' ? candidate.logoUrl : undefined,
          logoDevFetcher.imageUrl(candidate.website),
          brandfetchFetcher.logoUrl(candidate.website),
          candidate.logoUrl,
        ].filter(Boolean);

        if (!chain.length) return candidate;

        return { ...candidate, logoUrl: chain[0], logoFallbackUrl: chain[1] };
      });
  }

  /**
   * Suggestions that actually answer the query, then whatever is left to fill
   * the list out.
   *
   * Wikidata's name search matches loosely, so a query it has nothing good for
   * comes back with items that match nothing at all - "acme" returns the
   * University of Milan. They are real organisations with real homepages, so
   * every filter up to here keeps them; the only thing wrong with them is that
   * nobody typing "acme" meant them.
   */
  answersFirst(candidates, term) {
    const answers = candidates.filter(c => this.answersQuery(c, term));
    if (answers.length >= 3) return answers;

    const rest = candidates.filter(c => !this.answersQuery(c, term));
    return [...answers, ...rest.slice(0, 3 - answers.length)];
  }

  /** Whether two names read as the same brand - "Snap" and "Snapchat" do. */
  sameBrandFamily(a, b) {
    const first = name => this.brandKey(name).split(' ')[0] || '';
    const one = first(a);
    const other = first(b);
    if (one.length < 3 || other.length < 3) return false;

    return one.startsWith(other) || other.startsWith(one);
  }

  /** Whether a suggestion is a plausible reading of what was typed. */
  answersQuery(candidate, term) {
    return Boolean(
      // A brand index only carries companies, and only returned this one
      // because it matched
      candidate.source === 'brand-index' ||
      // The parent or subsidiary of something that did match
      candidate.related ||
      this.mentions(candidate.name, term) ||
      // "L&T" matches Larsen & Toubro through an alias, not through its label
      this.mentions(candidate.matchedText, term)
    );
  }

  /**
   * A company name reduced to what makes it the same company.
   *
   * The brand index says "Snap", Wikidata says "Snap Inc." and Wikipedia says
   * "Snap, Inc." - all one account, and offering it three times is worse than
   * offering it once.
   */
  brandKey(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/[.,''&]/g, '')
      .replace(
        /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|llp|plc|sa|nv|ag|gmbh|oy|ab|as|bv|pte|pvt|private)\b/g,
        ''
      )
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Whether a logo URL is a site icon standing in for a real mark. */
  isFavicon(url) {
    return /s2\/favicons|favicon/i.test(String(url || ''));
  }

  /** One candidate turned into a scored, displayable suggestion. */
  describeOne(candidate, claims) {
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
  }

  /**
   * Companies connected to the matches: makers of the products the name
   * resolved to, and the family of the best company match.
   *
   * One extra batched call, and only when the first pass actually surfaced a
   * connection worth following. Swallows its own failure - the relatives are an
   * improvement on the list, never the reason there is no list.
   */
  async relatedCandidates(described, entities, term) {
    const have = new Set(described.map(c => c.wikidataId).filter(Boolean));
    const wanted = [];
    const relations = new Map();
    const want = (id, relation, madeBy) => {
      if (!id || have.has(id)) return;
      if (!relations.has(id)) relations.set(id, { relation, madeBy });
      if (!wanted.includes(id)) wanted.push(id);
    };

    const byScore = (a, b) => this.suggestionScore(b, term) - this.suggestionScore(a, term);

    // The company behind each product the typed name matched. Only products
    // actually *named* what was typed count - an article that merely discusses
    // the term would otherwise donate its maker, which is how a search for
    // "snapchat" once offered Meta (via the Instagram article) above Snap Inc.
    for (const candidate of described) {
      const claims = entities[candidate.wikidataId]?.claims;
      if (!claims || !candidate.excluded) continue;
      if (!this.mentions(candidate.name, term)) continue;
      for (const property of MAKER_CLAIMS) {
        want(
          firmographicsFetcher.itemId(firmographicsFetcher.best(claims[property])),
          'maker',
          candidate.name
        );
      }
    }

    // The parent and subsidiaries of the best real match
    const anchor = described.filter(c => c.organisation && !c.excluded).sort(byScore)[0];
    const anchorClaims = anchor && entities[anchor.wikidataId]?.claims;
    if (anchorClaims) {
      want(firmographicsFetcher.itemId(firmographicsFetcher.best(anchorClaims.P749)), 'family');
      for (const claim of (anchorClaims.P355 || []).slice(0, 5)) {
        want(firmographicsFetcher.itemId(claim), 'family');
      }
    }

    if (!wanted.length) return [];

    let relatives;
    try {
      relatives = await firmographicsFetcher.entities(wanted.slice(0, 8), 'labels|descriptions|claims');
    } catch (error) {
      console.warn('⚠️ Related-company lookup failed:', error.message);
      return [];
    }

    return Object.values(relatives)
      .filter(entity => entity?.claims && entity.labels?.en?.value)
      .map((entity, index) => {
        const { relation, madeBy } = relations.get(entity.id) || {};
        const name = this.cleanName(entity.labels.en.value);

        return this.describeOne(
          {
            name,
            snippet: entity.descriptions?.en?.value,
            wikidataId: entity.id,
            source: 'Wikidata',
            // A maker is only the account the rep meant when it is recognisably
            // the same brand: Snap Inc. makes Snapchat, and that is the whole
            // point of following the claim. The University of Milan also
            // "makes" something called ACME, and that is not a sales lead.
            related: relation === 'family' || this.sameBrandFamily(name, madeBy),
            rank: 20 + index,
          },
          entity.claims
        );
      });
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
    // Belonging to the matched company's family is worth more than sharing a
    // syllable with the query - it is what the person is actually looking at
    if (candidate.related) score += 20;
    // Ties fall back to the order the two searches returned
    score -= candidate.rank || 0;

    return score;
  }

  /** Strip the fields that only mattered while ranking. */
  presentable({ excluded, organisation, evidence, rank, related, filler, matchedText, ...candidate }) {
    return candidate;
  }

  /** Whether an item states something only an incorporated company has. */
  isIncorporated(claims) {
    return CORPORATE_CLAIMS.some(property => claims[property]?.length);
  }

  /** Whether a Wikidata item is something that can never be an account. */
  isNeverAnAccount(claims) {
    const instanceOf = (claims.P31 || [])
      .map(claim => claim.mainsnak?.datavalue?.value?.id)
      .filter(Boolean);

    if (instanceOf.some(id => NEVER_AN_ACCOUNT.has(id))) return true;

    // "Instance of software" excludes - except on the conflated items, where
    // the same entity also files revenue or a CEO and *is* the company
    return instanceOf.some(id => WORK_CLASSES.has(id)) && !this.isIncorporated(claims);
  }

  /** Whether a Wikidata item is a work rather than the company behind it. */
  isProduct(claims) {
    // Revenue, headcount, a CEO or a legal form settles it as a company
    // whatever else the item states - see CORPORATE_CLAIMS
    if (this.isIncorporated(claims)) return false;

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
