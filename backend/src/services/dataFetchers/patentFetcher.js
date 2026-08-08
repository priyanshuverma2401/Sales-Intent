const axios = require('axios');

/**
 * Patent filings and grants, by applicant.
 *
 * A patent is a dated, verifiable statement about where a company is spending
 * its R&D budget, filed long before the programme it belongs to is announced.
 * That is what makes it a whitespace signal rather than a trigger: it does not
 * tell a rep what to open a call with, it tells them which direction the
 * account is already moving in.
 *
 * Two providers are supported because USPTO retired its keyless API and the
 * replacement is keyed. Whichever key exists is the one used:
 *
 *   USPTO_API_KEY        USPTO Open Data Portal   developer.uspto.gov
 *   PATENTSVIEW_API_KEY  PatentsView Search API   patentsview.org/apis/keyrequest
 *
 * Both keys are free of charge. With neither set this returns nothing and the
 * patent block simply does not appear - no estimate, no proxy, no "patent
 * activity was reported in the press", which would be a different claim
 * wearing this one's clothes.
 */

const LOOKBACK_DAYS = Number(process.env.PATENT_LOOKBACK_DAYS) || 730;
const MAX_PATENTS = Number(process.env.MAX_PATENTS) || 6;

function since() {
  return new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);
}

/**
 * Patents are filed under a legal entity, which is rarely the name on the
 * account. Only the suffixes are stripped - no attempt is made to guess that a
 * subsidiary belongs to a parent, because getting that wrong attributes another
 * company's R&D to this one.
 */
function applicantName(companyName) {
  return String(companyName || '')
    .replace(/[.,]/g, ' ')
    .replace(/\b(inc|corp|corporation|ltd|limited|llc|plc|holdings|company|co)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Is this filing actually the account's?
 *
 * The same strictness as the contract matcher, for the same reason: a loose
 * match here puts a competitor's patents in the report under our name.
 */
function isSameApplicant(applicant, companyName) {
  const normalise = value => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(inc|corp|corporation|ltd|limited|llc|plc|holdings|group|company|co|the|gmbh|ag|sa|nv|kk)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const filed = normalise(applicant);
  const account = normalise(companyName);
  if (!filed || !account) return false;

  if (filed === account) return true;
  if (filed.includes(account) || account.includes(filed)) return true;

  const words = account.split(' ').filter(w => w.length > 3);
  return words.length > 0 && words.every(word => filed.includes(word));
}

/** PatentsView search API. Assignee organisation is the field that holds the applicant. */
async function fetchFromPatentsView(company) {
  const key = process.env.PATENTSVIEW_API_KEY;
  if (!key) return null;

  const name = applicantName(company.name);

  try {
    const { data } = await axios.get('https://search.patentsview.org/api/v1/patent/', {
      params: {
        q: JSON.stringify({
          _and: [
            { _gte: { patent_date: since() } },
            { _text_phrase: { 'assignees.assignee_organization': name } },
          ],
        }),
        f: JSON.stringify([
          'patent_id', 'patent_title', 'patent_date', 'patent_type',
          'assignees.assignee_organization',
        ]),
        o: JSON.stringify({ size: 25 }),
      },
      headers: { 'X-Api-Key': key },
      timeout: 15000,
    });

    return (data?.patents || []).map(patent => ({
      title: patent.patent_title,
      applicant: patent.assignees?.[0]?.assignee_organization || '',
      grantedAt: patent.patent_date ? new Date(patent.patent_date) : undefined,
      filedAt: undefined,
      status: 'granted',
      patentNumber: patent.patent_id,
      url: patent.patent_id ? `https://patents.google.com/patent/US${patent.patent_id}` : undefined,
    }));
  } catch (error) {
    console.warn(`⚠️ PatentsView unavailable: ${error.message}`);
    return null;
  }
}

/**
 * USPTO Open Data Portal.
 *
 * Its response shape has moved more than once, so every field is read
 * defensively: a provider that renames a key should cost the patent block, not
 * the whole report.
 */
async function fetchFromUspto(company) {
  const key = process.env.USPTO_API_KEY;
  if (!key) return null;

  const name = applicantName(company.name);

  try {
    const { data } = await axios.post(
      'https://api.uspto.gov/api/v1/patent/applications/search',
      {
        q: `applicationMetaData.firstApplicantName:"${name}"`,
        filters: [
          { name: 'applicationMetaData.filingDate', value: [`${since()}->${new Date().toISOString().slice(0, 10)}`] },
        ],
        sort: [{ field: 'applicationMetaData.filingDate', order: 'desc' }],
        pagination: { offset: 0, limit: 25 },
      },
      {
        headers: { 'X-API-KEY': key, 'Content-Type': 'application/json', Accept: 'application/json' },
        timeout: 15000,
      }
    );

    const rows = data?.patentFileWrapperDataBag || data?.results || data?.patentBag || [];

    return (Array.isArray(rows) ? rows : []).map(row => {
      const meta = row.applicationMetaData || row.patentMetaData || row;

      const granted = meta.grantDate || meta.patentIssueDate;

      return {
        title: meta.inventionTitle || meta.title || row.inventionTitle,
        applicant:
          meta.firstApplicantName ||
          meta.applicantBag?.[0]?.applicantNameText ||
          meta.assigneeBag?.[0]?.assigneeNameText ||
          '',
        filedAt: meta.filingDate ? new Date(meta.filingDate) : undefined,
        grantedAt: granted ? new Date(granted) : undefined,
        status: granted ? 'granted' : 'filed',
        patentNumber: meta.patentNumber || meta.applicationNumberText || row.applicationNumberText,
        url: meta.patentNumber
          ? `https://patents.google.com/patent/US${meta.patentNumber}`
          : 'https://ppubs.uspto.gov/pubwebapp/',
      };
    });
  } catch (error) {
    const status = error?.response?.status;
    if (status === 401 || status === 403) {
      console.warn('⚠️ USPTO rejected the API key — check USPTO_API_KEY');
    } else {
      console.warn(`⚠️ USPTO unavailable: ${error.message}`);
    }
    return null;
  }
}

/**
 * @param {object} company must be tagged rndHeavy, or this returns []
 * @returns {Promise<object[]>} patent records, newest first
 */
async function fetchPatents(company = {}) {
  // The gate. A retailer or a services firm files nothing, and the request
  // would return an empty set on every report.
  if (!company.tags?.rndHeavy) return [];
  if (!company.name) return [];

  if (!process.env.USPTO_API_KEY && !process.env.PATENTSVIEW_API_KEY) {
    console.log('🔬 No patent API key set — patent block omitted');
    return [];
  }

  const raw = (await fetchFromUspto(company)) || (await fetchFromPatentsView(company)) || [];

  const records = raw
    .filter(patent => patent.title)
    // Exact applicant only. Zero patents is a valid, honest answer for an
    // account that files under a name we cannot confirm is theirs.
    .filter(patent => isSameApplicant(patent.applicant, company.name))
    .map(patent => ({ ...patent, citations: [] }))
    .sort((a, b) =>
      new Date(b.grantedAt || b.filedAt || 0) - new Date(a.grantedAt || a.filedAt || 0)
    )
    .slice(0, MAX_PATENTS);

  console.log(`🔬 ${records.length} patent record(s) for ${company.name}`);
  return records;
}

/** "Granted May 2026 — US11234567" */
function format(patent) {
  if (!patent) return '';

  const date = patent.grantedAt || patent.filedAt;
  const when = date
    ? new Date(date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '';

  const verb = patent.status === 'granted' ? 'Granted' : 'Filed';
  return [when ? `${verb} ${when}` : verb, patent.patentNumber].filter(Boolean).join(' — ');
}

module.exports = { fetchPatents, format, isSameApplicant, applicantName };
