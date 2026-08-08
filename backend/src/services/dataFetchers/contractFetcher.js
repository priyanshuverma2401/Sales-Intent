const axios = require('axios');

/**
 * US federal contract awards, from USAspending.gov.
 *
 * A contract win or loss is a matter of public record with a date, an amount
 * and a named agency on it, which makes it a cleaner trigger than most news:
 * nothing here is speculation or a press office's framing. An account that has
 * just won a large federal task order has budget, a delivery deadline and a
 * staffing problem, all three of them verifiable.
 *
 * Free and keyless. Only runs for accounts tagged as government-facing - for a
 * purely commercial account every query returns an empty result set, and the
 * request is wasted on every report.
 *
 * US federal only. A UK bank or an Indian IT services firm has no record here
 * however much government work it does, so a nil result is never presented as
 * "this account does no public-sector business" - only as "no US federal award
 * records", which is all this source can actually speak to.
 */

const ENDPOINT = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';

// Contract award types. Grants and loans are a different kind of relationship
// and would muddy what the section claims.
const CONTRACT_TYPES = ['A', 'B', 'C', 'D'];

const LOOKBACK_DAYS = Number(process.env.CONTRACT_LOOKBACK_DAYS) || 730;
const MAX_AWARDS = Number(process.env.MAX_CONTRACT_AWARDS) || 6;

/**
 * Names as USAspending holds them: "BOOZ ALLEN HAMILTON INC".
 *
 * The search is a text match, so the legal suffixes that differ between our
 * record and theirs are dropped rather than fought with.
 */
function searchName(companyName) {
  return String(companyName || '')
    .replace(/[.,]/g, ' ')
    .replace(/\b(inc|corp|corporation|ltd|limited|llc|plc|holdings|group|company|co)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Did this award actually go to the account, or to a company with a similar
 * name? USAspending matches loosely, so "Norwegian" would return awards to
 * every organisation with the word in its name.
 */
function isSameCompany(recipient, companyName) {
  const normalise = value => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(inc|corp|corporation|ltd|limited|llc|plc|holdings|group|company|co|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const award = normalise(recipient);
  const account = normalise(companyName);
  if (!award || !account) return false;

  // Either name containing the other is the normal case - "booz allen hamilton"
  // against "booz allen hamilton holding"
  if (award.includes(account) || account.includes(award)) return true;

  // Otherwise every significant word of the account name has to appear, so
  // "Norwegian Cruise Line" does not match "Norwegian Air Shuttle"
  const words = account.split(' ').filter(w => w.length > 3);
  return words.length > 0 && words.every(word => award.includes(word));
}

function startDate() {
  return new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);
}

/**
 * @param {object} company must be tagged governmentFacing, or this returns []
 * @returns {Promise<object[]>} award records, largest first
 */
async function fetchAwards(company = {}) {
  // The gate. Skipped entirely for commercial accounts.
  if (!company.tags?.governmentFacing) return [];

  const name = searchName(company.name);
  if (!name) return [];

  try {
    const { data } = await axios.post(
      ENDPOINT,
      {
        filters: {
          award_type_codes: CONTRACT_TYPES,
          recipient_search_text: [name],
          time_period: [{ start_date: startDate(), end_date: new Date().toISOString().slice(0, 10) }],
        },
        fields: [
          'Award ID', 'Recipient Name', 'Award Amount', 'Awarding Agency',
          'Start Date', 'End Date', 'Description', 'Contract Award Type',
        ],
        sort: 'Award Amount',
        order: 'desc',
        limit: 25,
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 20000 }
    );

    const awards = (data?.results || [])
      // The loose text match is tightened here, not in the query
      .filter(row => isSameCompany(row['Recipient Name'], company.name))
      .slice(0, MAX_AWARDS)
      .map(row => ({
        awardId: row['Award ID'],
        recipient: row['Recipient Name'],
        agency: row['Awarding Agency'],
        amount: Number(row['Award Amount']) || undefined,
        startedAt: row['Start Date'] ? new Date(row['Start Date']) : undefined,
        endedAt: row['End Date'] ? new Date(row['End Date']) : undefined,
        description: String(row.Description || '').replace(/\s+/g, ' ').trim().slice(0, 300),
        awardType: row['Contract Award Type'],
        url: row.generated_internal_id
          ? `https://www.usaspending.gov/award/${row.generated_internal_id}`
          : 'https://www.usaspending.gov/',
        citations: [],
      }));

    console.log(`🏛️  ${awards.length} federal award(s) for ${company.name}`);
    return awards;
  } catch (error) {
    console.warn(`⚠️ USAspending unavailable for ${company.name}: ${error.message}`);
    return [];
  }
}

/** "$1.38B — General Services Administration (March 2021)" */
function format(award) {
  if (!award) return '';

  const money = value => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
    return `$${n.toLocaleString()}`;
  };

  const date = award.startedAt
    ? new Date(award.startedAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '';

  const head = [money(award.amount), award.agency].filter(Boolean).join(' — ');
  return date ? `${head} (${date})` : head;
}

module.exports = { fetchAwards, format, isSameCompany, searchName };
