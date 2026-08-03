const axios = require('axios');
const cheerio = require('cheerio');

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

class JobDataFetcher {
  // LinkedIn has no free public jobs API. Left as an explicit no-op so callers
  // get a consistent shape rather than an error.
  async fetchFromLinkedIn(companyName) {
    console.log('📋 LinkedIn job fetching requires authentication - skipped');
    return [];
  }

  // Fetch from Indeed (public data).
  // Indeed aggressively blocks datacenter traffic, so a 403 here is expected
  // and must not take the surrounding refresh/report down with it.
  async fetchFromIndeed(companyName) {
    try {
      const searchUrl = `https://www.indeed.com/jobs?q=${encodeURIComponent(companyName)}`;

      const response = await axios.get(searchUrl, {
        headers: BROWSER_HEADERS,
        timeout: 8000,
      });

      const $ = cheerio.load(response.data);
      const jobs = [];

      $('.job_seen_beacon').each((i, element) => {
        if (jobs.length >= 5) return false;

        const title = $(element).find('[data-testid="job-title"]').text().trim()
          || $(element).find('h2.jobTitle').text().trim();
        const company = $(element).find('[data-testid="company-name"]').text().trim();
        const location = $(element).find('[data-testid="text-location"]').text().trim()
          || $(element).find('[data-testid="job-location"]').text().trim();

        if (title) {
          jobs.push({
            title,
            company: company || companyName,
            location,
            type: 'job_opening',
            source: 'Indeed',
          });
        }
      });

      return jobs;
    } catch (error) {
      console.error('⚠️ Indeed fetch error:', error.message);
    }

    return [];
  }

  // Derive hiring signals from news headlines
  fetchHiringSignals(newsArticles = []) {
    const keywords = [
      'hiring', 'recruitment', 'expanding team', 'new positions',
      'talent acquisition', 'headcount', 'layoff', 'job cuts',
    ];

    return this.matchArticles(newsArticles, keywords, 'hiring_signal');
  }

  // Main job data fetch
  async fetchJobData(companyName) {
    console.log(`💼 Fetching job data for ${companyName}`);

    const jobsData = {
      openPositions: [],
      recentHirings: [],
      hiringTrend: 'stable',
      timestamp: new Date(),
    };

    const [indeedJobs, linkedInJobs] = await Promise.all([
      this.fetchFromIndeed(companyName),
      this.fetchFromLinkedIn(companyName),
    ]);

    jobsData.openPositions.push(...indeedJobs, ...linkedInJobs);

    console.log(`✅ Found ${jobsData.openPositions.length} open positions`);
    return jobsData;
  }

  // Shared matcher: returns at most one entry per article, no matter how many
  // keywords hit. The previous version pushed once per matching keyword, so a
  // headline containing "named" and "new head of" was emitted twice.
  matchArticles(newsArticles, keywords, type) {
    const matches = [];

    (newsArticles || []).forEach(article => {
      const text = `${article.title || ''} ${article.description || ''}`.toLowerCase();

      if (keywords.some(keyword => text.includes(keyword))) {
        matches.push({
          title: article.title,
          description: article.description,
          source: article.source,
          url: article.url,
          date: article.publishedAt,
          type,
        });
      }
    });

    return matches;
  }

  // Parse executive appointments from news
  parseExecutiveAppointments(newsArticles) {
    const executiveKeywords = [
      'appointed', 'hired as', 'joins as', 'becomes ceo', 'becomes cfo',
      'becomes cto', 'new vp', 'new director', 'new head of', 'steps down',
    ];

    return this.matchArticles(newsArticles, executiveKeywords, 'executive_appointment');
  }
}

module.exports = new JobDataFetcher();
