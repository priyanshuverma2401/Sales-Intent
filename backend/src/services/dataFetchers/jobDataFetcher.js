const axios = require('axios');
const cheerio = require('cheerio');
const { convert } = require('html-to-text');

// Open roles are the strongest buying signal in the report - a company hiring
// twelve ML engineers is telling you what it is about to spend money on. The
// old Indeed scrape returned nothing (Indeed blocks datacenter traffic, and the
// markup it keyed on has since changed), so hiring contributed zero evidence.
//
// These platforms publish a company's board as free, keyless JSON with the full
// job description rather than a title. Greenhouse, Lever and Ashby cover most
// tech companies; SmartRecruiters and Workday cover the large enterprises that
// used to return nothing at all - banks, insurers, cruise lines - which is
// exactly the population this report is written about.
//
// Workday and iCIMS cannot be guessed at. Their URLs carry a tenant and a site
// name that exist nowhere else, so they are only reachable when somebody has
// put the account's real careers URL on the record.
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
  {
    name: 'SmartRecruiters',
    // Common at large European enterprises. Returns 100 per page; one page is
    // plenty, since only a handful of roles ever reach the prompt.
    url: slug => `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100`,
    parse: data =>
      (data?.content || []).map(job => ({
        title: job.name,
        location: [job.location?.city, job.location?.region, job.location?.country]
          .filter(Boolean).join(', '),
        url: `https://jobs.smartrecruiters.com/${job.company?.identifier || ''}/${job.id}`,
        description: job.jobAd?.sections?.jobDescription?.text
          ? htmlToPlain(job.jobAd.sections.jobDescription.text)
          : '',
        postedAt: job.releasedDate,
      })),
    // The list endpoint carries the true total even when the page is capped
    total: data => data?.totalFound,
  },
];

/**
 * Workday, which does not fit the shape above.
 *
 * It is a POST rather than a GET, its host carries a data-centre number, and
 * both the tenant and the site name have to come off a real careers URL. In
 * exchange it is the only board that reports the full open-role count directly
 * and breaks it down by job family, which is most of the hiring line for free.
 */
async function fetchWorkday({ tenant, site, dc }) {
  const base = `https://${tenant}.${dc}.myworkdayjobs.com`;

  const { data } = await axios.post(
    `${base}/wday/cxs/${tenant}/${site}/jobs`,
    { appliedFacets: {}, limit: 20, offset: 0, searchText: '' },
    {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      timeout: 12000,
    }
  );

  const jobs = (data?.jobPostings || []).map(job => ({
    title: job.title,
    location: job.locationsText,
    url: job.externalPath ? `${base}/en-US/${site}${job.externalPath}` : base,
    description: '',
    postedAt: relativePostedAt(job.postedOn),
  }));

  // Workday's own job-family facet, which is a cleaner breakdown than anything
  // keyword matching on titles can produce
  const families = (data?.facets || [])
    .find(f => f.facetParameter === 'jobFamilyGroup')?.values || [];

  return {
    jobs,
    total: data?.total,
    families: families.map(v => ({ name: v.descriptor, count: v.count })),
  };
}

/**
 * Workday dates arrive as "Posted Today" / "Posted 30+ Days Ago" rather than a
 * timestamp. What can be read exactly is converted; "30+" is deliberately left
 * undated rather than pinned to a day nobody said.
 */
function relativePostedAt(value) {
  const text = String(value || '').toLowerCase();
  if (!text) return undefined;

  const day = 86400000;
  if (text.includes('today')) return new Date().toISOString();
  if (text.includes('yesterday')) return new Date(Date.now() - day).toISOString();

  const days = /posted\s+(\d+)\s*\+?\s*days?\s+ago/.exec(text);
  if (days && !text.includes('+')) {
    return new Date(Date.now() - Number(days[1]) * day).toISOString();
  }

  return undefined;
}

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

/**
 * Read the ATS straight off the account's careers URL.
 *
 * Guessing a slug from the company name works for tech companies and fails for
 * everyone else. A real URL is unambiguous - and for Workday and iCIMS it is
 * the only thing that identifies the tenant at all.
 */
function detectBoard(careersUrl) {
  if (!careersUrl) return null;

  let url;
  try {
    url = new URL(String(careersUrl).trim());
  } catch (_) {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const segments = url.pathname.split('/').filter(Boolean);

  if (host.includes('greenhouse.io')) {
    // boards.greenhouse.io/acme, job-boards.greenhouse.io/acme
    return segments[0] ? { board: 'Greenhouse', slug: segments[0] } : null;
  }
  if (host.includes('lever.co')) {
    return segments[0] ? { board: 'Lever', slug: segments[0] } : null;
  }
  if (host.includes('ashbyhq.com')) {
    return segments[0] ? { board: 'Ashby', slug: segments[0] } : null;
  }
  if (host.includes('smartrecruiters.com')) {
    return segments[0] ? { board: 'SmartRecruiters', slug: segments[0] } : null;
  }
  if (host.includes('myworkdayjobs.com')) {
    // acme.wd5.myworkdayjobs.com/en-US/AcmeCareers  ->  tenant acme, dc wd5,
    // site AcmeCareers. The locale segment is optional and is not the site.
    const [tenant, dc] = host.split('.');
    const site = segments.find(s => !/^[a-z]{2}-[A-Z]{2}$/.test(s));
    return tenant && dc && site ? { board: 'Workday', tenant, dc, site } : null;
  }
  if (host.includes('icims.com')) {
    // iCIMS exposes no consistent public JSON endpoint - the portal path
    // differs per client and most are behind a session. Recorded so the report
    // can cite the board, never fetched.
    return { board: 'iCIMS', slug: host.split('.')[0], fetchable: false };
  }

  return null;
}

// "Palo Alto Networks, Inc." -> ["paloaltonetworks", "palo-alto-networks", "palo"].
// The fallback for accounts with no careers URL on file. Board slugs are the
// company name with the legal suffix dropped, in one of two spellings. The
// leading word is tried as well because boards are registered under the brand
// rather than the legal name - "Notion Labs" publishes at ashby/notion. A wrong
// guess costs one 404 on a request already in flight.
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

/**
 * Which part of the business a role belongs to.
 *
 * The hiring line says "121 open roles across trade operations and compliance",
 * and that sentence is only worth printing if the grouping is right. Ordered
 * most specific first: a "Compliance Systems Engineer" is a compliance hire,
 * not a tech one, and whichever rule runs first decides.
 */
const FUNCTIONS = [
  { name: 'compliance', words: ['compliance', 'regulatory', 'aml', 'kyc', 'financial crime', 'audit', 'risk', 'legal', 'counsel', 'sanctions', 'governance'] },
  { name: 'finance', words: ['finance', 'accounting', 'accountant', 'treasury', 'controller', 'fp&a', 'tax', 'payroll', 'actuarial'] },
  { name: 'hr', words: ['human resources', 'people ', 'talent', 'recruit', 'hr ', 'learning', 'culture', 'benefits', 'compensation'] },
  { name: 'sales', words: ['sales', 'account executive', 'account manager', 'business development', 'revenue', 'marketing', 'brand', 'commercial', 'partnership', 'customer success'] },
  { name: 'tech', words: ['engineer', 'developer', 'software', 'data', 'devops', 'cloud', 'platform', 'architect', 'security', 'analytics', 'machine learning', 'ai ', 'scientist', 'technology', 'it ', 'digital', 'product manager', 'qa ', 'sre'] },
  { name: 'ops', words: ['operations', 'operational', 'logistics', 'supply chain', 'procurement', 'facilities', 'warehouse', 'fulfil', 'service delivery', 'support', 'maintenance', 'production', 'quality', 'trade '] },
];

function classifyFunction(title = '', description = '') {
  const text = ` ${String(title).toLowerCase()} `;

  for (const fn of FUNCTIONS) {
    if (fn.words.some(word => text.includes(word))) return fn.name;
  }

  // The title alone is often a job code; the body decides the rest
  const body = ` ${String(description).slice(0, 600).toLowerCase()} `;
  for (const fn of FUNCTIONS) {
    if (fn.words.some(word => body.includes(word))) return fn.name;
  }

  return 'other';
}

// City out of "London, United Kingdom" / "5 Locations" / "Remote - US".
// Workday in particular reports a count instead of a place when a role is open
// in several, and a count is not somewhere the account is hiring.
function normaliseLocation(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (/^\d+\s+locations?$/i.test(text)) return '';

  return text.split(/[,|/]/)[0].trim().replace(/^(remote|hybrid)\s*[-–]\s*/i, '').slice(0, 40);
}

const FUNCTION_LABELS = {
  ops: 'operations',
  compliance: 'compliance',
  tech: 'technology',
  finance: 'finance',
  sales: 'sales and marketing',
  hr: 'HR',
  other: 'other functions',
};

class JobDataFetcher {
  constructor() {
    // company name -> {board, slug}. A report runs several passes and the
    // refresh path re-reads the same accounts, so remembering which board
    // answered avoids replaying the 404s every time.
    this.boardCache = new Map();
  }

  // LinkedIn and Indeed have no free public jobs API, and both forbid scraping
  // at any scale. The account's URLs for them are kept on the record and cited,
  // never fetched.
  async fetchFromLinkedIn() {
    return [];
  }

  /**
   * Find the company's public job board and read it.
   *
   * The careers URL on the account is authoritative when set. Without one, the
   * slug is guessed against every board at once - a 404 is the normal answer
   * for "this is not their ATS", so failures are silent and the first board
   * that returns postings wins.
   */
  async fetchFromBoards(company) {
    const name = typeof company === 'string' ? company : company?.name;
    const careersUrl = typeof company === 'object' ? company?.pages?.careersUrl : null;

    const known = detectBoard(careersUrl);

    if (known && known.board === 'Workday') {
      try {
        const { jobs, total, families } = await fetchWorkday(known);
        console.log(`✅ ${total ?? jobs.length} open roles from Workday (${known.tenant})`);
        return {
          jobs: jobs.map(job => ({ ...job, source: 'Workday', type: 'job_opening' })),
          total,
          families,
        };
      } catch (error) {
        console.log(`📋 Workday board unreachable for ${name}: ${error.message}`);
        return { jobs: [], total: undefined, families: [] };
      }
    }

    if (known && known.fetchable === false) {
      console.log(`📋 ${known.board} has no public feed — careers URL cited only`);
      return { jobs: [], total: undefined, families: [] };
    }

    const cached = this.boardCache.get(name);
    const pinned = known || cached;

    const pairs = pinned
      ? [[BOARDS.find(b => b.name === pinned.board), pinned.slug]]
      : slugCandidates(name).flatMap(slug => BOARDS.map(board => [board, slug]));

    if (!pairs.length || !pairs[0][0]) return { jobs: [], total: undefined, families: [] };

    const attempts = await Promise.all(
      pairs.map(async ([board, slug]) => {
        try {
          const { data } = await axios.get(board.url(slug), { timeout: 8000 });
          const jobs = board.parse(data).filter(job => job.title);
          return jobs.length ? { board, slug, jobs, total: board.total?.(data) } : null;
        } catch (error) {
          return null;
        }
      })
    );

    const hit = attempts.find(Boolean);
    if (!hit) {
      this.boardCache.delete(name);
      console.log(`📋 No public job board found for ${name}`);
      return { jobs: [], total: undefined, families: [] };
    }

    this.boardCache.set(name, { board: hit.board.name, slug: hit.slug });
    console.log(`✅ ${hit.total ?? hit.jobs.length} open roles from ${hit.board.name} (${hit.slug})`);

    return {
      jobs: hit.jobs.map(job => ({ ...job, source: hit.board.name, type: 'job_opening' })),
      total: hit.total,
      families: [],
    };
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

  /**
   * The hiring line: "121 open roles across trade operations and compliance,
   * concentrated in Bangkok and Dubai".
   *
   * Counted here rather than described by the model, because the model has no
   * way to count and every figure in this sentence has to be real. Returns null
   * when there is nothing to count - the report then shows no hiring line at
   * all, which is the correct answer for an account with no public board.
   */
  summarise(jobs = [], { total, families = [], source } = {}) {
    if (!jobs.length && !total) return null;

    const tally = (list, key) => {
      const counts = new Map();
      list.forEach(item => {
        const value = key(item);
        if (!value) return;
        counts.set(value, (counts.get(value) || 0) + 1);
      });
      return [...counts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
    };

    // Workday states its own job families, which beats anything inferred from
    // titles. Everywhere else the titles are all there is.
    const byFunction = families.length
      ? families.slice(0, 6)
      : tally(jobs, job => FUNCTION_LABELS[classifyFunction(job.title, job.description)]);

    const byLocation = tally(jobs, job => normaliseLocation(job.location));

    // The count from the board's own metadata is the true one; the array length
    // is only the page we read
    const totalRoles = Number.isFinite(total) ? total : jobs.length;

    const topFunctions = byFunction.slice(0, 2).map(f => f.name);
    const topLocations = byLocation.slice(0, 2).map(l => l.name);

    const sentence = [
      `${totalRoles.toLocaleString()} open role${totalRoles === 1 ? '' : 's'}`,
      topFunctions.length ? `across ${topFunctions.join(' and ')}` : '',
      topLocations.length ? `concentrated in ${topLocations.join(' and ')}` : '',
    ].filter(Boolean).join(' ');

    return {
      totalRoles,
      byFunction: byFunction.slice(0, 6),
      byLocation: byLocation.slice(0, 5),
      summary: `${sentence}.`,
      source: source || jobs[0]?.source || 'Careers board',
      citations: [],
    };
  }

  // Derive hiring signals from news headlines
  fetchHiringSignals(newsArticles = []) {
    const keywords = [
      'hiring', 'recruitment', 'expanding team', 'new positions',
      'talent acquisition', 'headcount', 'layoff', 'job cuts',
    ];

    return this.matchArticles(newsArticles, keywords, 'hiring_signal');
  }

  /**
   * Main job data fetch. `keywords` decides the order, not the contents.
   *
   * @param {object|string} company the Company document, or a bare name for
   *                                callers that have nothing else
   */
  async fetchJobData(company, keywords = []) {
    const name = typeof company === 'string' ? company : company?.name;
    console.log(`💼 Fetching job data for ${name}`);

    const { jobs, total, families } = await this.fetchFromBoards(company).catch(() => ({
      jobs: [], total: undefined, families: [],
    }));

    const openPositions = this.rankByKeywords(jobs, keywords).map(job => ({
      ...job,
      function: classifyFunction(job.title, job.description),
    }));

    return {
      openPositions,
      hiring: this.summarise(openPositions, { total, families, source: jobs[0]?.source }),
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

  // Parse executive appointments from news.
  // Kept for the signals feed, which files a headline as-is. The report uses
  // extractors/executiveMoves.js instead, which pulls the name and role out.
  parseExecutiveAppointments(newsArticles) {
    const executiveKeywords = [
      'appointed', 'hired as', 'joins as', 'becomes ceo', 'becomes cfo',
      'becomes cto', 'new vp', 'new director', 'new head of', 'steps down',
    ];

    return this.matchArticles(newsArticles, executiveKeywords, 'executive_appointment');
  }
}

module.exports = new JobDataFetcher();
module.exports.detectBoard = detectBoard;
module.exports.classifyFunction = classifyFunction;
module.exports.FUNCTION_LABELS = FUNCTION_LABELS;
