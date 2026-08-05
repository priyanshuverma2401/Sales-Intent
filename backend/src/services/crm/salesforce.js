const axios = require('axios');

// Salesforce adapter. Authenticates with the OAuth refresh-token grant, which
// is what a connected app issues once and is the only flow that works without
// hosting a redirect callback for every customer.
//
// Everything returned here is already in the normalised shape the rest of the
// app consumes - see services/crm/index.js for the contract.

const API_VERSION = process.env.SALESFORCE_API_VERSION || 'v60.0';
const TIMEOUT = 15000;

// SOQL has no parameter binding, so anything interpolated into a query must be
// escaped. A prospect called "O'Reilly" would otherwise break the query, and a
// hostile account name could rewrite it.
function soqlEscape(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function readableError(error, fallback) {
  const body = error.response?.data;
  const detail = Array.isArray(body) ? body[0]?.message : body?.error_description || body?.message;
  return new Error(detail || error.message || fallback);
}

class SalesforceAdapter {
  get id() {
    return 'salesforce';
  }
  get label() {
    return 'Salesforce';
  }

  /** Mints an access token. Returns { accessToken, instanceUrl, identityUrl }. */
  async authenticate({ loginUrl, clientId, clientSecret, refreshToken }) {
    const base = String(loginUrl || 'https://login.salesforce.com').replace(/\/+$/, '');

    try {
      const res = await axios.post(
        `${base}/services/oauth2/token`,
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
        }),
        { timeout: TIMEOUT, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      return {
        accessToken: res.data.access_token,
        instanceUrl: res.data.instance_url,
        identityUrl: res.data.id,
      };
    } catch (error) {
      throw readableError(error, 'Salesforce rejected those credentials');
    }
  }

  async query(session, soql) {
    const res = await axios.get(`${session.instanceUrl}/services/data/${API_VERSION}/query`, {
      params: { q: soql },
      headers: { Authorization: `Bearer ${session.accessToken}` },
      timeout: TIMEOUT,
    });
    return res.data.records || [];
  }

  /** Who the token belongs to - shown in the UI so an admin can confirm the org. */
  async describeConnection(session) {
    try {
      const res = await axios.get(`${session.instanceUrl}/services/data/${API_VERSION}/`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
        timeout: TIMEOUT,
      });
      // The identity URL ends in /id/{orgId}/{userId}
      const orgId = String(session.identityUrl || '').split('/id/')[1]?.split('/')[0];
      return { name: orgId ? `Salesforce org ${orgId}` : 'Salesforce', detail: Object.keys(res.data).length };
    } catch {
      return { name: 'Salesforce' };
    }
  }

  /**
   * Everything the CRM knows about one prospect, by name. Returns null when the
   * CRM has no account matching it - a miss, not an error.
   */
  async fetchAccount(session, { name, website }) {
    const needle = soqlEscape(name);

    // Exact name first, then a LIKE, then the website domain: "HSBC" in
    // SalesMotion and "HSBC Holdings plc" in Salesforce are the same account.
    const accounts = await this.query(
      session,
      `SELECT Id, Name, Type, Industry, Website, AnnualRevenue, NumberOfEmployees, Rating,
              Description, LastActivityDate, Owner.Name
       FROM Account
       WHERE Name = '${needle}' OR Name LIKE '${needle}%'
       ORDER BY LastActivityDate DESC NULLS LAST
       LIMIT 1`
    );

    let account = accounts[0];

    if (!account && website) {
      const domain = soqlEscape(String(website).replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]);
      const byDomain = await this.query(
        session,
        `SELECT Id, Name, Type, Industry, Website, AnnualRevenue, NumberOfEmployees, Rating,
                Description, LastActivityDate, Owner.Name
         FROM Account WHERE Website LIKE '%${domain}%' LIMIT 1`
      );
      account = byDomain[0];
    }

    if (!account) return null;

    const [opportunities, contacts, tasks] = await Promise.all([
      this.query(
        session,
        `SELECT Id, Name, StageName, Amount, CloseDate, Probability, NextStep, Type,
                IsClosed, IsWon, LastModifiedDate, Owner.Name
         FROM Opportunity WHERE AccountId = '${account.Id}'
         ORDER BY LastModifiedDate DESC LIMIT 25`
      ).catch(() => []),
      this.query(
        session,
        `SELECT Id, Name, Title, Email, Department
         FROM Contact WHERE AccountId = '${account.Id}' LIMIT 25`
      ).catch(() => []),
      this.query(
        session,
        `SELECT Id, Subject, Status, ActivityDate, Description, Who.Name, TaskSubtype
         FROM Task WHERE AccountId = '${account.Id}'
         ORDER BY ActivityDate DESC NULLS LAST LIMIT 20`
      ).catch(() => []),
    ]);

    return {
      account: {
        externalId: account.Id,
        name: account.Name,
        owner: account.Owner?.Name,
        type: account.Type,
        rating: account.Rating,
        industry: account.Industry,
        website: account.Website,
        annualRevenue: account.AnnualRevenue,
        employees: account.NumberOfEmployees,
        description: account.Description,
        lastActivityAt: account.LastActivityDate ? new Date(account.LastActivityDate) : undefined,
        url: `${session.instanceUrl}/lightning/r/Account/${account.Id}/view`,
      },
      opportunities: opportunities.map(o => ({
        externalId: o.Id,
        name: o.Name,
        stage: o.StageName,
        amount: o.Amount,
        closeDate: o.CloseDate ? new Date(o.CloseDate) : undefined,
        probability: o.Probability,
        nextStep: o.NextStep,
        owner: o.Owner?.Name,
        isClosed: Boolean(o.IsClosed),
        isWon: Boolean(o.IsWon),
        updatedAt: o.LastModifiedDate ? new Date(o.LastModifiedDate) : undefined,
      })),
      contacts: contacts.map(c => ({
        externalId: c.Id,
        name: c.Name,
        title: c.Title,
        email: c.Email,
        department: c.Department,
      })),
      activities: tasks.map(t => ({
        externalId: t.Id,
        subject: t.Subject,
        kind: t.TaskSubtype ? String(t.TaskSubtype).toLowerCase() : 'task',
        status: t.Status,
        occurredAt: t.ActivityDate ? new Date(t.ActivityDate) : undefined,
        who: t.Who?.Name,
        summary: t.Description ? String(t.Description).slice(0, 400) : undefined,
      })),
    };
  }
}

module.exports = new SalesforceAdapter();
