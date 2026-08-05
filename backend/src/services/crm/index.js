const CrmConnection = require('../../models/CrmConnection');
const CrmRecord = require('../../models/CrmRecord');
const Company = require('../../models/Company');
const Signal = require('../../models/Signal');
const User = require('../../models/User');
const { encrypt, decrypt } = require('./secrets');
const salesforce = require('./salesforce');
const zoho = require('./zoho');

// The tenant's CRM, normalised.
//
// An adapter answers three questions - can I authenticate, who am I, what do you
// know about this account - and everything above this layer works on the shape
// they both return. Adding a third CRM is a new adapter and one line here.

const ADAPTERS = { salesforce, zoho };

const MAX_ACCOUNTS_PER_SYNC = Number(process.env.CRM_MAX_ACCOUNTS_PER_SYNC) || 200;

class CrmService {
  adapter(provider) {
    const adapter = ADAPTERS[provider];
    if (!adapter) throw new Error(`Unsupported CRM provider: ${provider}`);
    return adapter;
  }

  providers() {
    return Object.values(ADAPTERS).map(a => ({ id: a.id, label: a.label }));
  }

  /** The tenant's active connection, or null. */
  async connectionFor(organizationId) {
    if (!organizationId) return null;
    return CrmConnection.findOne({ organizationId, status: { $ne: 'disconnected' } });
  }

  // ---- credentials -------------------------------------------------------

  /**
   * Verifies the credentials before storing anything: a connection that cannot
   * mint a token is worse than no connection, because it looks configured.
   */
  async connect({ organization, user, provider, credentials }) {
    const adapter = this.adapter(provider);

    const session = await adapter.authenticate(credentials);
    const identity = await adapter.describeConnection(session);

    const update = {
      organizationId: organization._id,
      provider,
      status: 'connected',
      clientId: credentials.clientId,
      clientSecret: encrypt(credentials.clientSecret),
      refreshToken: encrypt(credentials.refreshToken),
      connectedAccount: identity.name,
      connectedBy: user._id,
      connectedByName: `${user.firstName} ${user.lastName}`.trim(),
      lastSyncError: undefined,
      updatedAt: new Date(),
    };

    if (provider === 'salesforce') {
      update.loginUrl = credentials.loginUrl || 'https://login.salesforce.com';
      update.instanceUrl = session.instanceUrl;
    } else {
      update.accountsUrl = credentials.accountsUrl || 'https://accounts.zoho.com';
      update.apiDomain = session.apiDomain;
    }

    return CrmConnection.findOneAndUpdate(
      { organizationId: organization._id, provider },
      { $set: update, $setOnInsert: { createdAt: new Date() } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  }

  /** Mints a fresh access token for a stored connection. */
  async session(connection) {
    const adapter = this.adapter(connection.provider);

    const credentials = {
      clientId: connection.clientId,
      clientSecret: decrypt(connection.clientSecret),
      refreshToken: decrypt(connection.refreshToken),
      loginUrl: connection.loginUrl,
      accountsUrl: connection.accountsUrl,
    };

    try {
      const session = await adapter.authenticate(credentials);

      // Salesforce can move an org between instances, and Zoho returns the API
      // domain per token, so both are refreshed on every authentication.
      const patch = {};
      if (session.instanceUrl && session.instanceUrl !== connection.instanceUrl) {
        patch.instanceUrl = session.instanceUrl;
      }
      if (session.apiDomain && session.apiDomain !== connection.apiDomain) {
        patch.apiDomain = session.apiDomain;
      }
      if (connection.status !== 'connected') patch.status = 'connected';
      if (Object.keys(patch).length) {
        await CrmConnection.updateOne({ _id: connection._id }, { $set: patch });
        Object.assign(connection, patch);
      }

      return { ...session, instanceUrl: session.instanceUrl || connection.instanceUrl };
    } catch (error) {
      // A revoked refresh token is permanent - flag the connection so the UI can
      // say "reconnect" instead of failing silently on every report.
      await CrmConnection.updateOne(
        { _id: connection._id },
        { $set: { status: 'error', lastSyncError: error.message?.slice(0, 300) } }
      );
      throw error;
    }
  }

  async test(connection) {
    const session = await this.session(connection);
    const identity = await this.adapter(connection.provider).describeConnection(session);
    return { ok: true, account: identity.name };
  }

  // ---- sync --------------------------------------------------------------

  /** Every company any seat in the tenant watches. */
  async organizationCompanies(organizationId) {
    const users = await User.find({ organizationId }).select('watchlist').lean();

    const ids = new Map();
    users.forEach(u =>
      (u.watchlist || []).forEach(w => {
        if (w.companyId) ids.set(String(w.companyId), w.companyId);
      })
    );

    if (!ids.size) return [];
    return Company.find({ _id: { $in: [...ids.values()] } }).limit(MAX_ACCOUNTS_PER_SYNC);
  }

  /**
   * Pulls one account and stores the snapshot. Returns the CrmRecord, including
   * the `matched: false` case - a miss is cached so a report does not re-query
   * a CRM that has never heard of the prospect.
   */
  async syncCompany(connection, company, { session, emitSignals = true } = {}) {
    const adapter = this.adapter(connection.provider);
    const live = session || (await this.session(connection));

    const previous = await CrmRecord.findOne({
      organizationId: connection.organizationId,
      companyId: company._id,
    });

    let bundle = null;
    let error;
    try {
      bundle = await adapter.fetchAccount(live, { name: company.name, website: company.website });
    } catch (e) {
      error = e.message?.slice(0, 300);
    }

    const record = await CrmRecord.findOneAndUpdate(
      { organizationId: connection.organizationId, companyId: company._id },
      {
        $set: {
          companyName: company.name,
          provider: connection.provider,
          matched: Boolean(bundle),
          account: bundle?.account || undefined,
          opportunities: bundle?.opportunities || [],
          contacts: bundle?.contacts || [],
          activities: bundle?.activities || [],
          fetchedAt: new Date(),
          error,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    let signalsCreated = 0;
    if (emitSignals && bundle && connection.usage?.signals !== false) {
      signalsCreated = await this.emitSignals({ connection, company, previous, record });
    }

    return { record, signalsCreated, error };
  }

  /** Sync every watched account. Returns the counts the settings screen shows. */
  async syncOrganization(connection, { onProgress = () => {} } = {}) {
    const companies = await this.organizationCompanies(connection.organizationId);
    const session = await this.session(connection);

    const counts = {
      accountsMatched: 0,
      accountsMissing: 0,
      opportunities: 0,
      contacts: 0,
      activities: 0,
      signalsCreated: 0,
    };
    let failures = 0;

    for (let i = 0; i < companies.length; i += 1) {
      const company = companies[i];
      try {
        const { record, signalsCreated, error } = await this.syncCompany(connection, company, {
          session,
        });

        if (error) failures += 1;
        if (record.matched) {
          counts.accountsMatched += 1;
          counts.opportunities += record.opportunities?.length || 0;
          counts.contacts += record.contacts?.length || 0;
          counts.activities += record.activities?.length || 0;
        } else {
          counts.accountsMissing += 1;
        }
        counts.signalsCreated += signalsCreated;
      } catch (e) {
        // One unreachable account must not abandon the rest of the sync
        failures += 1;
        console.error(`CRM sync failed for ${company.name}:`, e.message);
      }

      onProgress(i + 1, companies.length);
    }

    const status = failures === 0 ? 'ok' : failures === companies.length ? 'failed' : 'partial';

    await CrmConnection.updateOne(
      { _id: connection._id },
      {
        $set: {
          lastSyncAt: new Date(),
          lastSyncStatus: status,
          lastSyncCounts: counts,
          lastSyncError: status === 'ok' ? undefined : `${failures} account(s) could not be read`,
          status: status === 'failed' ? 'error' : 'connected',
        },
      }
    );

    return { ...counts, status, total: companies.length };
  }

  // ---- consumption -------------------------------------------------------

  /**
   * The CRM context for one report. Refreshes the snapshot when it is older than
   * the connection's freshness window, and never throws: a CRM outage degrades
   * the report to public-data-only rather than failing the run.
   */
  async contextFor(organization, company, { purpose = 'reports' } = {}) {
    try {
      const connection = await this.connectionFor(organization?._id);
      if (!connection || connection.usage?.[purpose] === false) return null;

      let record = await CrmRecord.findOne({
        organizationId: connection.organizationId,
        companyId: company._id,
      });

      const maxAgeMs = (connection.freshnessHours || 24) * 3600 * 1000;
      const stale = !record || Date.now() - new Date(record.fetchedAt).getTime() > maxAgeMs;

      if (stale && connection.status === 'connected') {
        const result = await this.syncCompany(connection, company);
        record = result.record;
      }

      if (!record?.matched) return null;
      return record.toContext();
    } catch (error) {
      console.error('CRM context unavailable:', error.message);
      return null;
    }
  }

  // ---- signals -----------------------------------------------------------

  /**
   * Diffs the previous snapshot against the new one and writes a Signal per
   * change. Signals carry organizationId, so one tenant's pipeline is never
   * visible to another tenant watching the same company.
   */
  async emitSignals({ connection, company, previous, record }) {
    const label = this.adapter(connection.provider).label;
    const before = new Map((previous?.opportunities || []).map(o => [o.externalId, o]));
    const knownContacts = new Set((previous?.contacts || []).map(c => c.externalId));
    const pending = [];

    const base = {
      companyId: company._id,
      companyName: company.name,
      ticker: company.ticker,
      organizationId: connection.organizationId,
      type: 'crm',
      source: label,
      sourceUrl: record.account?.url,
      confidence: 100, // it is the tenant's own record, not an inference
    };

    (record.opportunities || []).forEach(opp => {
      const prior = before.get(opp.externalId);
      const money = this.formatAmount(opp.amount, opp.currency);

      if (!prior) {
        pending.push({
          ...base,
          crmKey: `opp:new:${opp.externalId}`,
          category: 'crm_opportunity',
          title: `New opportunity: ${opp.name}`,
          description: [money, opp.stage, opp.closeDate ? `closing ${this.formatDate(opp.closeDate)}` : null]
            .filter(Boolean)
            .join(' · '),
          priority: (opp.amount || 0) >= 100000 ? 'high' : 'medium',
        });
        return;
      }

      if (prior.stage !== opp.stage) {
        const won = opp.isWon;
        const lost = opp.isClosed && !opp.isWon;

        pending.push({
          ...base,
          // Keyed on the stage it moved to, so the same move is not re-signalled
          crmKey: `opp:stage:${opp.externalId}:${opp.stage}`,
          category: won ? 'crm_won' : lost ? 'crm_lost' : 'crm_stage_change',
          title: won
            ? `Closed won: ${opp.name}`
            : lost
              ? `Closed lost: ${opp.name}`
              : `${opp.name} moved to ${opp.stage}`,
          description: [`Was ${prior.stage || 'unset'}`, money].filter(Boolean).join(' · '),
          priority: won || lost ? 'high' : 'medium',
        });
      }
    });

    (record.contacts || []).forEach(contact => {
      if (knownContacts.has(contact.externalId) || !previous) return;
      pending.push({
        ...base,
        crmKey: `contact:new:${contact.externalId}`,
        category: 'crm_contact',
        title: `New contact: ${contact.name}${contact.title ? `, ${contact.title}` : ''}`,
        description: [contact.department, contact.email].filter(Boolean).join(' · '),
        priority: 'low',
      });
    });

    // A stalled open deal is the signal a rep most wants and least often gets
    const openDeals = (record.opportunities || []).filter(o => !o.isClosed);
    const lastActivity = record.toContext().lastActivityAt;
    if (openDeals.length && lastActivity) {
      const days = Math.floor((Date.now() - new Date(lastActivity).getTime()) / 86400000);
      if (days >= 30) {
        pending.push({
          ...base,
          // Bucketed by month so it re-fires as the gap widens, not every sync
          crmKey: `stalled:${company._id}:${Math.floor(days / 30)}`,
          category: 'crm_stalled',
          title: `No CRM activity for ${days} days with ${openDeals.length} open deal${openDeals.length === 1 ? '' : 's'}`,
          description: openDeals.map(o => `${o.name} (${o.stage})`).slice(0, 3).join(' · '),
          priority: 'high',
        });
      }
    }

    if (!pending.length) return 0;

    // Upsert on crmKey: a re-sync of unchanged data writes nothing new
    const results = await Promise.all(
      pending.map(signal =>
        Signal.updateOne(
          { organizationId: signal.organizationId, crmKey: signal.crmKey },
          { $setOnInsert: { ...signal, detectedAt: new Date(), createdAt: new Date() } },
          { upsert: true }
        ).catch(() => ({ upsertedCount: 0 }))
      )
    );

    return results.filter(r => r.upsertedCount).length;
  }

  formatAmount(amount, currency) {
    if (!amount && amount !== 0) return null;
    const symbol = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : '$';
    if (Math.abs(amount) >= 1e6) return `${symbol}${(amount / 1e6).toFixed(1)}M`;
    if (Math.abs(amount) >= 1e3) return `${symbol}${Math.round(amount / 1e3)}k`;
    return `${symbol}${amount}`;
  }

  formatDate(value) {
    return new Date(value).toISOString().slice(0, 10);
  }
}

module.exports = new CrmService();
