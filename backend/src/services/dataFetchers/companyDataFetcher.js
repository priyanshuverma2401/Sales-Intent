const axios = require('axios');
const financialDataFetcher = require('./financialDataFetcher');

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
          // Named `logo` so it lines up with what the caller stores as logoUrl;
          // this used to be returned as `image` and was silently discarded.
          logo: page.thumbnail?.source,
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

    const [wikipediaData, crunchbaseData, fundamentals] = await Promise.all([
      this.fetchFromWikipedia(companyName),
      this.fetchFromCrunchbase(companyName),
      // Finnhub carries industry / website / logo / country, which Wikipedia's
      // extract does not. Without this the stored company had a blank industry.
      ticker ? financialDataFetcher.getCompanyFundamentals(ticker) : Promise.resolve(null),
    ]);

    if (wikipediaData) companyInfo = { ...companyInfo, ...wikipediaData };
    if (crunchbaseData) companyInfo = { ...companyInfo, ...crunchbaseData };

    if (fundamentals) {
      // Only fill gaps - never clobber a richer Wikipedia/Crunchbase value
      for (const key of ['industry', 'website', 'logo', 'country']) {
        if (!companyInfo[key] && fundamentals[key]) companyInfo[key] = fundamentals[key];
      }
      if (!companyInfo.ticker) companyInfo.ticker = fundamentals.ticker;
    }

    console.log('✅ Company info fetched');
    return companyInfo;
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

  // Search companies using multiple sources
  async searchCompanies(query) {
    console.log(`🔍 Searching for companies: ${query}`);

    const results = [];

    try {
      const response = await axios.get('https://en.wikipedia.org/w/api.php', {
        params: {
          action: 'query',
          list: 'search',
          srsearch: query,
          srnamespace: 0,
          srlimit: 5,
          format: 'json',
        },
        headers: WIKI_HEADERS,
        timeout: 8000,
      });

      response.data.query.search.forEach(result => {
        results.push({
          name: result.title,
          source: 'Wikipedia',
          // The API returns HTML search-match markup here
          snippet: String(result.snippet || '').replace(/<[^>]+>/g, ''),
        });
      });
    } catch (error) {
      console.error('⚠️ Wikipedia search error:', error.message);
    }

    console.log(`✅ Found ${results.length} companies`);
    return results;
  }
}

module.exports = new CompanyDataFetcher();
