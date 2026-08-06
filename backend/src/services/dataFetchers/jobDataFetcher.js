const axios = require('axios');
const cheerio = require('cheerio');
const { convert } = require('html-to-text');

// Open roles are the strongest buying signal in the report - a company hiring
// twelve ML engineers is telling you what it is about to spend money on. The
// old Indeed scrape returned nothing (Indeed blocks datacenter traffic, and the
// markup it keyed on has since changed), so hiring contributed zero evidence.
//
// These three ATS platforms publish every company's board as free, keyless
// JSON, with the full job description rather than a title. Most tech companies
// use one of them. Large enterprises on Workday/Taleo have no public board and
// still return nothing - that is a real gap, not a failure to handle.
const BOARDS = [
  {
    name: 'Greenhouse',
    url: slug => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
    parse: data =>
      (data?.jobs || []).map(job => ({
        title: job.title,
        location: job.location?.name,
        url: job.absolute_url,
        // Greenhouse returns its HTML entity-encoded, so it needs decoding
        // before the tags can be stripped
        description: htmlToPlain(job.content, { encoded: true }),
        postedAt: job.updated_at,
      })),
  },
  {
    name: 'Lever',
    url: slug => `https://api.lever.co/v0/postings/${slug}?mode=json`,
    parse: data =>
      (Array.isArray(data) ? data : []).map(job => ({
        title: job.text,
        location: job.categories?.location,
        url: job.hostedUrl,
        description: job.descriptionPlain || htmlToPlain(job.description),
        postedAt: job.createdAt ? new Date(job.createdAt).toISOString() : undefined,
      })),
  },
  {
    name: 'Ashby',
    url: slug => `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
    parse: data =>
      (data?.jobs || []).map(job => ({
        title: job.title,
        location: job.location,
        url: job.jobUrl,
        description: job.descriptionPlain || htmlToPlain(job.descriptionHtml),
        postedAt: job.publishedAt,
      })),
  },
];

// Job descriptions run to 5-10k characters of boilerplate-heavy HTML. Strip it
// to text here; SOURCE_BODY_CHARS decides how much of it reaches the prompt.
function htmlToPlain(html, { encoded = false } = {}) {
  if (!html) return '';

  // cheerio's .text() resolves entities, turning "&lt;p&gt;" back into markup
  const markup = encoded ? cheerio.load(`<x>${html}</x>`).root().text() : html;

  return convert(markup, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' },
    ],
  })
    .replace(/\s+/g, ' ')
    .trim();
}

// "Palo Alto Networks, Inc." -> ["paloaltonetworks", "palo-alto-networks", "palo"].
// Board slugs are the company name with the legal suffix dropped, in one of two
// spellings. The leading word is tried as well because boards are registered
// under the brand rather than the legal name - "Notion Labs" publishes at
// ashby/notion. A wrong guess costs one 404 on a request already in flight.
function slugCandidates(companyName) {
  const base = String(companyName || '')
    .toLowerCase()
    .replace(/[.,'']/g, '')
    .replace(/\b(inc|corp|corporation|ltd|limited|llc|plc|sa|nv|ag|holdings|group)\b/g, '')
    .trim();

  if (!base) return [];

  const words = base.split(/\s+/).filter(Boolean);
  const candidates = [base.replace(/[^a-z0-9]/g, ''), base.replace(/\s+/g, '-')];

  // Only when it is distinctive enough to be a brand in its own right
  if (words.length > 1 && words[0].length >= 4) candidates.push(words[0]);

  return [...new Set(candidates)].filter(Boolean);
}

class JobDataFetcher {
  constructor() {
    // company name -> {board, slug}. A report runs several passes and the
    // refresh path re-reads the same accounts, so remembering which board
    // answered avoids replaying the 404s every time.
    this.boardCache = new Map();
  }

  // LinkedIn has no free public jobs API. Left as an explicit no-op so callers
  // get a consistent shape rather than an error.
  async fetchFromLinkedIn(companyName) {
    console.log('📋 LinkedIn job fetching requires authentication - skipped');
    return [];
  }

  /**
   * Find the company's public job board and read it.
   *
   * A 404 is the normal answer for "this is not their ATS", so failures are
   * silent - only a total miss is worth logging. The first board that returns
   * postings wins; nobody publishes on two at once.
   */
  async fetchFromBoards(companyName) {
    const cached = this.boardCache.get(companyName);
    const pairs = cached
      ? [[BOARDS.find(b => b.name === cached.board), cached.slug]]
      : slugCandidates(companyName).flatMap(slug => BOARDS.map(board => [board, slug]));

    if (!pairs.length || !pairs[0][0]) return [];

    const attempts = await Promise.all(
      pairs.map(async ([board, slug]) => {
        try {
          const { data } = await axios.get(board.url(slug), { timeout: 8000 });
          const jobs = board.parse(data).filter(job => job.title);
          return jobs.length ? { board, slug, jobs } : null;
        } catch (error) {
          return null;
        }
      })
    );

    const hit = attempts.find(Boolean);
    if (!hit) {
      this.boardCache.delete(companyName);
      console.log(`📋 No public job board found for ${companyName}`);
      return [];
    }

    this.boardCache.set(companyName, { board: hit.board.name, slug: hit.slug });
    console.log(`✅ ${hit.jobs.length} open roles from ${hit.board.name} (${hit.slug})`);

    return hit.jobs.map(job => ({ ...job, source: hit.board.name, type: 'job_opening' }));
  }

  /**
   * Rank the roles that argue the seller's case first.
   *
   * A board can return 800 postings and only a handful reach the prompt, so
   * which handful matters more than how many. A rep pitching GenAI needs the ML
   * engineering roles, not the facilities manager - so postings mentioning a
   * pitch keyword sort to the top, exactly as keyword-matched news does.
   */
  rankByKeywords(jobs, keywords = []) {
    const terms = keywords.map(k => String(k).toLowerCase().trim()).filter(Boolean);
    if (!terms.length) return jobs;

    const scored = jobs.map(job => {
      const title = String(job.title || '').toLowerCase();
      const body = String(job.description || '').toLowerCase();
      const matched = terms.filter(t => title.includes(t) || body.includes(t));

      return {
        ...job,
        // A keyword in the title is a far stronger signal than one buried in
        // the benefits boilerplate every posting shares
        score: matched.reduce((sum, t) => sum + (title.includes(t) ? 10 : 1), 0),
        matchedKeyword: matched[0],
      };
    });

    return scored.sort((a, b) => b.score - a.score);
  }

  // Derive hiring signals from news headlines
  fetchHiringSignals(newsArticles = []) {
    const keywords = [
      'hiring', 'recruitment', 'expanding team', 'new positions',
      'talent acquisition', 'headcount', 'layoff', 'job cuts',
    ];

    return this.matchArticles(newsArticles, keywords, 'hiring_signal');
  }

  // Main job data fetch. `keywords` decides the order, not the contents.
  async fetchJobData(companyName, keywords = []) {
    console.log(`💼 Fetching job data for ${companyName}`);

    const [boardJobs, linkedInJobs] = await Promise.all([
      this.fetchFromBoards(companyName).catch(() => []),
      this.fetchFromLinkedIn(companyName),
    ]);

    const openPositions = this.rankByKeywords([...boardJobs, ...linkedInJobs], keywords);

    console.log(`✅ Found ${openPositions.length} open positions`);

    return {
      openPositions,
      recentHirings: [],
      hiringTrend: 'stable',
      timestamp: new Date(),
    };
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
