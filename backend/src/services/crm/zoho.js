const axios = require('axios');

// Zoho CRM adapter. Same contract as the Salesforce one, so nothing downstream
// knows which CRM a snapshot came from.
//
// Zoho is region-partitioned: a token minted at accounts.zoho.com is worthless
// against the EU or India data centres, which is why both hosts are stored on
// the connection rather than hardcoded.

const TIMEOUT = 15000;

function readableError(error, fallback) {
  const body = error.response?.data;
  const detail =
    body?.error_description ||
    body?.message ||
    (Array.isArray(body?.data) ? body.data[0]?.message : null) ||
    (typeof body?.error === 'string' ? body.error : null);
  return new Error(detail || error.message || fallback);
}

// Zoho search criteria are wrapped in parentheses and delimited by ( ) : , so a
// name containing them has to be stripped rather than escaped - Zoho has no
// escape syntax for the criteria grammar.
function criteriaSafe(value) {
  return String(value || '').replace(/[()<>,:]/g, ' ').trim();
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

class ZohoAdapter {
  get id() {
    return 'zoho';
  }
  get label() {
    return 'Zoho CRM';
  }

  async authenticate({ accountsUrl, clientId, clientSecret, refreshToken }) {
    const base = String(accountsUrl || 'https://accounts.zoho.com').replace(/\/+$/, '');

    try {
      const res = await axios.post(
        `${base}/oauth/v2/token`,
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
        }),
        { timeout: TIMEOUT, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      // Zoho answers 200 with an `error` body rather than a 4xx
      if (res.data.error) throw new Error(String(res.data.error));

      return {
        accessToken: res.data.access_token,
        apiDomain: res.data.api_domain || 'https://www.zohoapis.com',
      };
    } catch (error) {
      throw readableError(error, 'Zoho rejected those credentials');
    }
  }

  async get(session, path, params) {
    const res = await axios.get(`${session.apiDomain}/crm/v5${path}`, {
      params,
      headers: { Authorization: `Zoho-oauthtoken ${session.accessToken}` },
      timeout: TIMEOUT,
      // 204 means "no records" in Zoho, which axios would otherwise treat as an
      // empty body to parse
      validateStatus: status => (status >= 200 && status < 300) || status === 204,
    });
    return res.data?.data || [];
  }

  async describeConnection(session) {
    try {
      const orgs = await this.get(session, '/org');
      const org = Array.isArray(orgs) ? orgs[0] : null;
      return { name: org?.company_name || 'Zoho CRM' };
    } catch {
      return { name: 'Zoho CRM' };
    }
  }

  async fetchAccount(session, { name, website }) {
    const needle = criteriaSafe(name);
    if (!needle) return null;

    let accounts = await this.get(session, '/Accounts/search', {
      criteria: `(Account_Name:equals:${needle})`,
    }).catch(() => []);

    if (!accounts.length) {
      accounts = await this.get(session, '/Accounts/search', {
        criteria: `(Account_Name:starts_with:${needle})`,
      }).catch(() => []);
    }

    if (!accounts.length && website) {
      const domain = criteriaSafe(
        String(website).replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
      );
      accounts = await this.get(session, '/Accounts/search', {
        criteria: `(Website:contains:${domain})`,
      }).catch(() => []);
    }

    const account = accounts[0];
    if (!account) return null;

    const [deals, contacts, notes, tasks] = await Promise.all([
      this.get(session, `/Accounts/${account.id}/Deals`).catch(() => []),
      this.get(session, `/Accounts/${account.id}/Contacts`).catch(() => []),
      this.get(session, `/Accounts/${account.id}/Notes`).catch(() => []),
      this.get(session, `/Accounts/${account.id}/Tasks`).catch(() => []),
    ]);

    const closedStage = stage => /closed|won|lost/i.test(String(stage || ''));

    return {
      account: {
        externalId: account.id,
        name: account.Account_Name,
        owner: account.Owner?.name,
        type: account.Account_Type,
        rating: account.Rating,
        industry: account.Industry,
        website: account.Website,
        annualRevenue: toNumber(account.Annual_Revenue),
        employees: toNumber(account.Employees),
        description: account.Description,
        lastActivityAt: account.Last_Activity_Time ? new Date(account.Last_Activity_Time) : undefined,
        url: `${session.apiDomain.replace('www.zohoapis', 'crm.zoho')}/crm/tab/Accounts/${account.id}`,
      },
      opportunities: deals.map(d => ({
        externalId: d.id,
        name: d.Deal_Name,
        stage: d.Stage,
        amount: toNumber(d.Amount),
        currency: d.Currency,
        closeDate: d.Closing_Date ? new Date(d.Closing_Date) : undefined,
        probability: toNumber(d.Probability),
        nextStep: d.Next_Step,
        owner: d.Owner?.name,
        isClosed: closedStage(d.Stage),
        isWon: /won/i.test(String(d.Stage || '')),
        updatedAt: d.Modified_Time ? new Date(d.Modified_Time) : undefined,
      })),
      contacts: contacts.map(c => ({
        externalId: c.id,
        name: c.Full_Name || [c.First_Name, c.Last_Name].filter(Boolean).join(' '),
        title: c.Title,
        email: c.Email,
        department: c.Department,
      })),
      activities: [
        ...notes.map(n => ({
          externalId: n.id,
          subject: n.Note_Title || 'Note',
          kind: 'note',
          occurredAt: n.Created_Time ? new Date(n.Created_Time) : undefined,
          who: n.Owner?.name,
          summary: n.Note_Content ? String(n.Note_Content).slice(0, 400) : undefined,
        })),
        ...tasks.map(t => ({
          externalId: t.id,
          subject: t.Subject,
          kind: 'task',
          status: t.Status,
          occurredAt: t.Due_Date ? new Date(t.Due_Date) : undefined,
          who: t.Owner?.name,
          summary: t.Description ? String(t.Description).slice(0, 400) : undefined,
        })),
      ]
        .sort((a, b) => (b.occurredAt?.getTime() || 0) - (a.occurredAt?.getTime() || 0))
        .slice(0, 20),
    };
  }
}

module.exports = new ZohoAdapter();
