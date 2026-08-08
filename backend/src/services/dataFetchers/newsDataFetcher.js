const axios = require('axios');
const Parser = require('rss-parser');

// SUPERSEDED by dataFetchers/crawlService, which every caller now uses.
//
// This ran one generic Google News query plus one per keyword, which is what
// capped a report at about nine sources. The crawl that replaced it adds GDELT,
// Bing, vertical trade press, regulator feeds and the company's own press and
// blog feeds, and dedupes syndicated copies across all of them.
//
// Kept because the shape it returns is simple and self-contained, and because
// deleting a fetcher is the kind of change that is easy to regret when an
// upstream starts refusing traffic. Nothing imports it today.

// Multiple news sources for redundancy
const NEWS_SOURCES = {
  newsapi: {
    url: 'https://newsapi.org/v2',
    key: process.env.NEWS_API_KEY,
    active: !!process.env.NEWS_API_KEY,
  },
  googleNews: {
    // Google News RSS feed (no auth needed)
    url: 'https://news.google.com/rss',
    active: true,
  },
};

class NewsDataFetcher {
  // Fetch from NewsAPI
  async fetchFromNewsAPI(companyName, ticker) {
    if (!NEWS_SOURCES.newsapi.active) {
      console.warn('⚠️ NewsAPI not configured');
      return [];
    }

    try {
      const queries = [companyName, ticker].filter(Boolean);
      const allNews = [];

      for (const query of queries) {
        const response = await axios.get(`${NEWS_SOURCES.newsapi.url}/everything`, {
          params: {
            q: `"${query}"`,
            sortBy: 'publishedAt',
            language: 'en',
            pageSize: 10,
            apiKey: NEWS_SOURCES.newsapi.key,
          },
          timeout: 5000,
        });

        if (response.data.articles) {
          allNews.push(...response.data.articles);
        }
      }

      return this.normalizeNews(allNews);
    } catch (error) {
      console.error('❌ NewsAPI error:', error.message);
      return [];
    }
  }

  // Fetch from Google News RSS (free, no auth)
  async fetchFromGoogleNews(companyName) {
    try {
      const parser = new Parser();
      const feedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(companyName)}&hl=en-US&gl=US&ceid=US:en`;

      const feed = await parser.parseURL(feedUrl);

      return feed.items.slice(0, 10).map(item => ({
        title: item.title,
        description: item.content || item.summary || '',
        source: {
          name: 'Google News',
        },
        url: item.link,
        publishedAt: item.pubDate,
        imageUrl: null,
      }));
    } catch (error) {
      console.error('❌ Google News error:', error.message);
      return [];
    }
  }

  // Normalize news from different sources
  normalizeNews(articles) {
    return articles.map(article => ({
      title: article.title,
      description: article.description || article.summary || '',
      source: {
        name: article.source?.name || 'Unknown',
      },
      url: article.url || article.link,
      publishedAt: article.publishedAt || article.pubDate,
      imageUrl: article.urlToImage || null,
      author: article.author,
    }));
  }

  // Run one targeted feed per pitch keyword, e.g. "Microsoft Copilot".
  // Generic company news rarely surfaces the evidence a rep needs to argue that
  // a prospect is investing in the thing they are selling, so we ask for it
  // directly and tag the results as keyword-matched.
  async fetchKeywordNews(companyName, keywords = []) {
    const terms = keywords.map(k => String(k).trim()).filter(Boolean).slice(0, 5);
    if (terms.length === 0) return [];

    const parser = new Parser();

    const feeds = await Promise.all(
      terms.map(async (term) => {
        try {
          const query = `${companyName} ${term}`;
          const feed = await parser.parseURL(
            `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
          );

          return feed.items.slice(0, 6).map(item => ({
            title: item.title,
            description: item.content || item.summary || '',
            source: { name: 'Google News' },
            url: item.link,
            publishedAt: item.pubDate,
            imageUrl: null,
            matchedKeyword: term,
          }));
        } catch (error) {
          console.error(`❌ Keyword news error for "${term}":`, error.message);
          return [];
        }
      })
    );

    const flattened = feeds.flat();
    console.log(`✅ Found ${flattened.length} keyword-matched articles for ${terms.join(', ')}`);
    return flattened;
  }

  // Main fetch method - tries multiple sources.
  // `keywords` biases the result set toward the themes the rep is pitching.
  async fetchNews(companyName, ticker, keywords = []) {
    console.log(`📰 Fetching news for ${companyName} (${ticker})`);

    const [apiNews, googleNews, keywordNews] = await Promise.all([
      NEWS_SOURCES.newsapi.active ? this.fetchFromNewsAPI(companyName, ticker) : Promise.resolve([]),
      this.fetchFromGoogleNews(companyName),
      this.fetchKeywordNews(companyName, keywords),
    ]);

    // Keyword hits go first so they survive de-duplication with their tag intact
    const newsResults = [...keywordNews, ...apiNews, ...googleNews];

    // Remove duplicates by title
    const uniqueNews = Array.from(
      new Map(newsResults.map(n => [n.title, n])).values()
    );

    console.log(`✅ Found ${uniqueNews.length} news articles`);
    return uniqueNews;
  }
}

module.exports = new NewsDataFetcher();
