const axios = require('axios');
const financialDataFetcher = require('./financialDataFetcher');
const firmographicsFetcher = require('./firmographicsFetcher');

// Wikipedia's API rejects requests without a descriptive User-Agent
const WIKI_HEADERS = {
  'User-Agent': 'SalesMotion/1.0 (sales intelligence platform)',
};

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

/**
 * Classes that disqualify an article outright, even when it does carry one of
 * the claims above. A founder inherits their company's industry often enough
 * that the properties alone would let a person through.
 */
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
  async fetchCompanyInfo(companyName, ticker) {
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
      firmographicsFetcher.fetch(companyName, ticker).catch(error => {
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
    const missing =
      !company.city || needsRevenue || needsLogo || !company.employees || !company.industry ||
      !company.foundedYear || !company.country || company.country === 'Unknown';

    if (!missing) return false;

    // Plenty of private accounts have no public record at all. Without this,
    // every regenerated report would pay for the same three lookups and get the
    // same nothing back.
    const lastTried = company.dataSources?.wikidata?.lastFetched;
    const daysSince = lastTried ? (Date.now() - new Date(lastTried)) / 86400000 : Infinity;
    if (!force && daysSince < 7) return false;

    let facts;
    try {
      facts = await firmographicsFetcher.fetch(company.name, company.ticker);
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
   * Name suggestions for the "Add an account" box, each with its homepage.
   *
   * A search for "hdfc" returns HDFC Bank, HDFC, HDFC Life and HDFC ERGO -
   * four real and quite different companies whose one-line descriptions all
   * read "an Indian financial services company". The domain is what actually
   * tells them apart, so it is worth the second request to get it.
   *
   * Done with a search generator rather than list=search: the same call that
   * finds the pages also returns each one's Wikidata id, which is what the
   * homepages are then looked up against in a single batch. That same batch
   * says whether the article is an organisation at all, so the people, awards
   * and products the search ranks alongside the company get dropped.
   *
   * Twice as many candidates are asked for as are shown, because filtering
   * throws some away - "infosys" loses two of its first five.
   */
  async searchCompanies(query) {
    console.log(`🔍 Searching for companies: ${query}`);

    let results = [];

    try {
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

      results = (response.data.query?.pages || [])
        // A generator returns pages in arbitrary order; index is the ranking
        .sort((a, b) => (a.index || 0) - (b.index || 0))
        .map(page => ({
          name: page.title,
          source: 'Wikipedia',
          snippet: String(page.extract || '').replace(/\s+/g, ' ').trim(),
          wikidataId: page.pageprops?.wikibase_item,
        }));

      results = (await this.describeFromWikidata(results)).slice(0, 6);
    } catch (error) {
      console.error('⚠️ Wikipedia search error:', error.message);
    }

    console.log(`✅ Found ${results.length} companies`);
    return results;
  }

  /**
   * Attach each suggestion's homepage and drop the ones that are not companies,
   * from one batched Wikidata call.
   *
   * Swallows its own failures and returns the list untouched: an unfiltered
   * suggestion list is worse but still usable, and a Wikidata outage must never
   * be the reason the search box comes back empty.
   */
  async describeFromWikidata(results) {
    const ids = results.map(r => r.wikidataId).filter(Boolean);
    if (!ids.length) return results;

    let entities;
    try {
      entities = await firmographicsFetcher.entities(ids, 'claims');
    } catch (error) {
      console.error('⚠️ Suggestion lookup failed:', error.message);
      return results;
    }

    return results.filter(result => {
      const claims = entities[result.wikidataId]?.claims;
      // An article Wikidata has nothing on is kept rather than guessed at -
      // a small private prospect is likelier than a false positive
      if (!claims) return true;

      const website = claims.P856?.[0]?.mainsnak?.datavalue?.value;
      // Shown as a domain, which is what a person recognises
      if (website) result.website = this.hostname(website);

      return this.isOrganisation(claims);
    });
  }

  /** Whether a Wikidata item's claims describe an organisation. */
  isOrganisation(claims) {
    const instanceOf = (claims.P31 || [])
      .map(claim => claim.mainsnak?.datavalue?.value?.id)
      .filter(Boolean);

    if (instanceOf.some(id => NEVER_AN_ACCOUNT.has(id))) return false;

    return ORGANISATION_CLAIMS.some(property => claims[property]?.length);
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
