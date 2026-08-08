/**
 * Which crawls run for which account.
 *
 * The vertical trade press, the regulator feeds, the patent search and the
 * federal contract search are all narrow: run them against an account they do
 * not apply to and they return nothing, having cost a request each. A cruise
 * line has no bank regulator; a retailer has no federal awards.
 *
 * So every account carries a vertical and three exposure flags, guessed from
 * its industry when it is added and correctable by hand afterwards. `autoTagged`
 * records which of the two it is, so a backfill can improve a guess without
 * overwriting somebody's correction.
 *
 * Tags only ever ADD sources. An untagged account still gets the full
 * cross-industry crawl - it just does not get the cruise trade press as well.
 */

// Google News reaches these by `site:` query rather than by scraping them, so a
// publisher behind a paywall still yields its headline, date and link.
const ALWAYS_ON_PRESS = [
  'finextra.com',
  'cio.com',
];

const VERTICALS = {
  travel: {
    label: 'Travel / Aviation / Cruise / Hospitality',
    press: [
      'skift.com',
      'travelpulse.com',
      'phocuswire.com',
      'hospitalitynet.org',
      'hotelnewsnow.com',
      'str.com',
      'iata.org',
      'centreforaviation.com',
      'flightglobal.com',
      'cruiseindustrynews.com',
      'seatrade-cruise.com',
      'cruisemarketwatch.com',
    ],
    match: [
      'travel', 'airline', 'aviation', 'cruise', 'hotel', 'hospitality',
      'lodging', 'resort', 'tourism', 'leisure',
    ],
  },

  shipping: {
    label: 'Shipping / Logistics / Supply Chain',
    press: [
      'freightwaves.com',
      'joc.com',
      'gtreview.com',
      'alphaliner.axsmarine.com',
      'theloadstar.co.uk',
    ],
    match: [
      'shipping', 'logistics', 'freight', 'supply chain', 'marine', 'maritime',
      'transport', 'courier', 'ports', 'warehousing',
    ],
  },

  healthcare: {
    label: 'Healthcare / Life Sciences / Pharma',
    press: [
      'aha.org',
      'healthcareitnews.com',
      'efpia.eu',
      'clinicaltrials.gov',
    ],
    match: [
      'health', 'hospital', 'pharma', 'biotech', 'life science', 'medical',
      'medicine', 'clinic', 'diagnostic', 'drug',
    ],
  },

  insurance: {
    label: 'Insurance',
    press: [
      'reinsurancene.ws',
      'insurancebusinessmag.com',
    ],
    match: ['insurance', 'insurer', 'reinsurance', 'underwriting', 'actuarial'],
  },

  bfsi: {
    label: 'Banking / Financial Services',
    press: [
      'finextra.com',
    ],
    match: [
      'bank', 'financial service', 'capital market', 'asset management',
      'wealth management', 'payments', 'fintech', 'credit union', 'brokerage',
      'investment bank', 'lending', 'mortgage',
    ],
  },

  itbpm: {
    label: 'IT / BPM Services',
    press: [
      'nasscom.in',
      'cio.com',
    ],
    match: [
      'information technology', 'it service', 'software', 'consulting', 'bpm',
      'bpo', 'outsourcing', 'system integrat', 'technology service',
    ],
  },

  utilities: {
    label: 'Utilities / Energy',
    press: [
      'energy-storage.news',
    ],
    match: [
      'utility', 'utilities', 'energy', 'power', 'electric', 'gas', 'water',
      'renewable', 'grid', 'oil',
    ],
  },
};

/**
 * Regulator feeds, reached the same way as the trade press.
 *
 * Grouped by vertical because a bank has no energy regulator and a water
 * company has no AML supervisor - and a query that can only return nothing is
 * a request wasted on every report.
 *
 * The cyber advisory bodies sit under `all` because a serious advisory creates
 * the same forced, dated remediation budget in any regulated industry.
 */
const REGULATORS = {
  all: [
    { host: 'cyber.gov.au', name: 'Australian Cyber Security Centre' },
    { host: 'cert.govt.nz', name: 'CERT NZ' },
  ],
  bfsi: [
    { host: 'fca.org.uk', name: 'Financial Conduct Authority' },
    { host: 'bankofengland.co.uk', name: 'Bank of England / PRA' },
    { host: 'bafin.de', name: 'BaFin' },
    { host: 'austrac.gov.au', name: 'AUSTRAC' },
    { host: 'fdic.gov', name: 'FDIC' },
  ],
  insurance: [
    { host: 'content.naic.org', name: 'NAIC' },
    { host: 'fca.org.uk', name: 'Financial Conduct Authority' },
  ],
  healthcare: [
    { host: 'cdc.gov', name: 'Centers for Disease Control and Prevention' },
  ],
  utilities: [
    { host: 'aer.gov.au', name: 'Australian Energy Regulator' },
    { host: 'ofgem.gov.uk', name: 'Ofgem' },
    { host: 'ofwat.gov.uk', name: 'Ofwat' },
  ],
};

// Verticals whose accounts carry compliance obligations with dates attached.
// Fix 7's whole argument: regulation creates obligation, not just opportunity.
const REGULATED_VERTICALS = new Set(['bfsi', 'insurance', 'healthcare', 'utilities']);

// Industries where a patent search returns something. Everywhere else it
// returns nothing and the request is wasted.
const RND_MATCH = [
  'technology', 'software', 'semiconductor', 'pharma', 'biotech', 'medical',
  'manufactur', 'aerospace', 'defence', 'defense', 'automotive', 'chemical',
  'electronics', 'engineering', 'telecom', 'energy', 'machinery',
];

// Industries with federal customers. USAspending covers US federal awards, so
// this is about whether the account sells to government at all.
const GOVERNMENT_MATCH = [
  'defence', 'defense', 'aerospace', 'consulting', 'information technology',
  'it service', 'engineering', 'construction', 'infrastructure', 'health',
  'transport', 'security', 'telecom', 'energy', 'utilities', 'logistics',
];

function haystack(company = {}) {
  return [company.industry, company.sector, company.description]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function hits(text, terms) {
  return terms.some(term => text.includes(term));
}

/**
 * Guess the vertical and exposure flags from what we know about the company.
 *
 * Deliberately conservative: a flag that is wrongly ON costs a handful of
 * requests that return nothing, but a vertical that is wrongly SET sends the
 * crawl to the wrong trade press entirely, so the vertical needs a real match
 * rather than a weak one.
 */
function derive(company = {}) {
  const text = haystack(company);

  let vertical = null;
  if (text) {
    // Longest match wins: "insurance" inside "banking and insurance" should not
    // lose to whichever key happened to be declared first
    let best = 0;
    for (const [key, spec] of Object.entries(VERTICALS)) {
      for (const term of spec.match) {
        if (text.includes(term) && term.length > best) {
          best = term.length;
          vertical = key;
        }
      }
    }
  }

  return {
    vertical,
    regulated: vertical ? REGULATED_VERTICALS.has(vertical) : false,
    governmentFacing: hits(text, GOVERNMENT_MATCH),
    rndHeavy: hits(text, RND_MATCH),
    autoTagged: true,
  };
}

/**
 * Fill in tags for an account that has none, leaving hand-set ones alone.
 * Returns true when the company document was changed and needs saving.
 */
function backfill(company) {
  if (!company) return false;
  // A human has been here - their answer stands
  if (company.tags && company.tags.autoTagged === false) return false;
  if (company.tags?.vertical) return false;

  company.tags = { ...(company.tags || {}), ...derive(company) };
  return true;
}

/** Trade-press hosts to crawl for this account, always-on ones included. */
function pressHosts(company = {}) {
  const vertical = company.tags?.vertical;
  const specific = vertical ? VERTICALS[vertical]?.press || [] : [];
  return [...new Set([...ALWAYS_ON_PRESS, ...specific])];
}

/** Regulator feeds to crawl, or [] when the account is not in a regulated industry. */
function regulatorFeeds(company = {}) {
  if (!company.tags?.regulated) return [];

  const vertical = company.tags?.vertical;
  return [...REGULATORS.all, ...(vertical ? REGULATORS[vertical] || [] : [])];
}

function verticalLabel(vertical) {
  return VERTICALS[vertical]?.label || null;
}

module.exports = {
  derive,
  backfill,
  pressHosts,
  regulatorFeeds,
  verticalLabel,
  VERTICALS,
  REGULATORS,
  REGULATED_VERTICALS,
};
