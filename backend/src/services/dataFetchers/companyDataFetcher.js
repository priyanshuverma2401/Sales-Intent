const axios = require('axios');
const financialDataFetcher = require('./financialDataFetcher');
const firmographicsFetcher = require('./firmographicsFetcher');

// Wikipedia's API rejects requests without a descriptive User-Agent
const WIKI_HEADERS = {
  'User-Agent': 'SalesMotion/1.0 (sales intelligence platform)',
};

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
      firmographicsFetcher.fetch(companyName, ticker),
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

    const facts = await firmographicsFetcher.fetch(company.name, company.ticker);

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
   * homepages are then looked up against in a single batch.
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
          gsrlimit: 5,
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

      await this.attachWebsites(results);
    } catch (error) {
      console.error('⚠️ Wikipedia search error:', error.message);
    }

    console.log(`✅ Found ${results.length} companies`);
    return results;
  }

  /**
   * Fill in each suggestion's homepage from one batched Wikidata call.
   *
   * Mutates in place and swallows its own failures: a suggestion list without
   * domains is still perfectly usable, and this must never be the reason the
   * search box comes back empty.
   */
  async attachWebsites(results) {
    const ids = results.map(r => r.wikidataId).filter(Boolean);
    if (!ids.length) return;

    try {
      const entities = await firmographicsFetcher.entities(ids, 'claims');

      for (const result of results) {
        const claims = entities[result.wikidataId]?.claims;
        const website = claims?.P856?.[0]?.mainsnak?.datavalue?.value;
        // Shown as a domain, which is what a person recognises
        if (website) result.website = this.hostname(website);
      }
    } catch (error) {
      console.error('⚠️ Suggestion website lookup failed:', error.message);
    }
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
