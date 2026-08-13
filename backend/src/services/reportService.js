const fs = require('fs');
const Report = require('../models/Report');
const Inbox = require('../models/Inbox');
const intelligenceService = require('./intelligenceService');
const reportGenerator = require('./reportGenerator');
const aiEngine = require('./aiEngine');
const crmService = require('./crm');
const companyDataFetcher = require('./dataFetchers/companyDataFetcher');
const accountTagging = require('./accountTagging');
const activityLog = require('./activityLog');

// How long a run may be in flight before a second request is allowed to start
// its own. Matches the report sweeper's threshold: past this point the pipeline
// is assumed dead rather than slow, so refusing to re-run would leave the
// account stuck behind a report nothing is writing.
const RUN_TIMEOUT_MS = Number(process.env.REPORT_STALE_AFTER_MS) || 15 * 60 * 1000;

/**
 * Owns the "generate a report" use case so both the accounts route (auto-run on
 * add) and the reports route (re-run on demand) drive the same pipeline.
 */
class ReportService {
  /**
   * The seller lens. It comes entirely from the tenant's company profile, so
   * every seat generates the same analysis for the same prospect - the rep only
   * decides which accounts to look at, not how they are read.
   */
  resolveContext(user, organization) {
    const seller = organization
      ? organization.toSellerContext()
      : { name: user.company, capabilities: [], valuePropositions: [], topics: [], focusTerms: [] };

    return { seller, reader: user.toReader() };
  }

  buildFastFacts(company, financial = {}) {
    // 'Unknown' is the placeholder stored for a company added before its country
    // could be resolved. Carried onto the cover it reads "Headquartered in
    // Unknown", so it is dropped and the line simply does not appear.
    const place = [company.city, company.state, company.country]
      .filter(part => part && String(part).toLowerCase() !== 'unknown');

    return {
      description: company.description,
      industry: company.industry,
      headquarters: place.join(', ') || undefined,
      employees: company.employees,
      employeesAsOf: company.employeesAsOf,
      founded: company.foundedYear,
      website: company.website,
      ticker: company.ticker,
      marketCap: company.financials?.marketCap || company.stock?.marketCap || financial.marketCap,
      revenue: company.financials?.revenue || financial.revenue,
      // Reported currency, not assumed dollars - a London or Bengaluru account
      // files in its own
      revenueCurrency: company.financials?.revenueCurrency,
      revenueAsOf: company.financials?.revenueAsOf,
      logoUrl: company.logoUrl,
    };
  }

  /**
   * The links on the report cover.
   *
   * LinkedIn and Crunchbase are both reachable only by their own identifier, so
   * these open the company's own page when Wikidata stated one for the account
   * and fall back to a search otherwise - said as much in the label, since
   * clicking "LinkedIn" and landing on a list of 1,700 results reads as a bug.
   */
  buildQuickLinks(company) {
    const links = [];

    if (company.website) {
      links.push({
        label: company.website.replace(/^https?:\/\//, '').replace(/\/$/, ''),
        url: company.website,
      });
    }
    if (company.ticker) {
      links.push({
        label: `${company.ticker} on Yahoo Finance`,
        url: `https://finance.yahoo.com/quote/${company.ticker}`,
      });
    }

    // The pages somebody put on the account. Indeed and LinkedIn Jobs are here
    // and nowhere else: neither publishes a free API and both forbid scraping,
    // so the report links to them rather than pretending to have read them.
    const pages = company.pages || {};
    const extra = [
      [pages.careersUrl, 'Careers'],
      [pages.investorRelationsUrl, 'Investor relations'],
      [pages.pressUrl, 'Newsroom'],
      [pages.indeedUrl, 'Indeed'],
      [pages.linkedInPeopleUrl, 'LinkedIn people'],
    ];

    extra.forEach(([url, label]) => {
      if (url) links.push({ label, url });
    });

    const profiles = company.profiles || {};

    links.push(
      profiles.crunchbase
        ? { label: 'Crunchbase', url: profiles.crunchbase }
        : {
            label: 'Search Crunchbase',
            url: `https://www.crunchbase.com/textsearch?q=${encodeURIComponent(company.name)}`,
          }
    );
    links.push(
      profiles.linkedin
        ? { label: 'LinkedIn', url: profiles.linkedin }
        : {
            label: 'Search LinkedIn',
            url: `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(company.name)}`,
          }
    );

    return links;
  }

  /**
   * The lens this report was written through, frozen onto the Report so an old
   * report still explains itself after an admin edits the company profile.
   */
  buildContextStamp(seller) {
    return {
      sellerName: seller.name,
      sellerCapabilities: seller.capabilities,
      sellerValuePropositions: seller.valuePropositions,
      priorityTopics: seller.priorityTopics || [],
      topics: seller.standardTopics || [],
      technologies: seller.relevantTechnologies || [],
      targetIndustries: seller.targetIndustries || [],
      targetDepartments: seller.targetDepartments || [],
    };
  }

  /** Why a report cannot be generated yet, or null when it can. */
  validate(seller) {
    if (!aiEngine.enabled) {
      return {
        status: 503,
        error: 'AI generation is not configured. Set the AZURE_OPENAI_* credentials on the server to generate reports.',
        code: 'AI_DISABLED',
      };
    }
    if (!seller.focusTerms?.length) {
      return {
        status: 400,
        error: 'The company profile has no capabilities or relevant topics yet. Ask an owner or admin to fill it in under Settings → Company profile — it decides what every report focuses on.',
        code: 'PROFILE_INCOMPLETE',
      };
    }
    return null;
  }

  /**
   * The tenant's report on one account, if it already has one.
   *
   * Scoped to the organization rather than the seat: the lens is the company
   * profile, so a report a colleague generated is the report this caller would
   * have generated. Callers with no organization - single-seat accounts, and
   * anything created before organizations existed - fall back to their own.
   */
  findForAccount({ user, organization, company }) {
    const scope = organization?._id
      ? { organizationId: organization._id, companyId: company._id }
      : { userId: user._id, companyId: company._id };

    // Newest first, so a tenant that still holds pre-dedupe duplicates keeps
    // rewriting the most recent of them rather than reviving an old one
    return Report.findOne(scope).sort({ generatedAt: -1 });
  }

  /**
   * Whether a run is already in flight for this report, so a second request
   * joins it instead of starting a parallel pipeline against the same document.
   *
   * A run that has been going far longer than one can plausibly take is treated
   * as dead - the process it lived in is gone (see reportSweeper) and nothing
   * will ever finish it.
   */
  isRunning(report) {
    const startedAt = report.refresh?.status === 'pending'
      ? report.refresh.startedAt
      : report.status === 'pending' && report.generatedAt;

    if (!startedAt) return false;

    return Date.now() - new Date(startedAt).getTime() < RUN_TIMEOUT_MS;
  }

  /**
   * Generate a report on one account, and return it immediately - the ~60s of
   * fetching and AI work finishes in the background.
   *
   * There is one report per account per tenant. Asking for a report on an
   * account the team already has one for rewrites that report rather than
   * filing a second copy of it: two people adding the same prospect used to
   * leave two near-identical reports side by side in the list, which is a
   * duplicate rather than a second opinion.
   *
   * A finished report is left fully readable while it is rewritten - see the
   * `refresh` field on the model.
   */
  async start({ user, organization, company }) {
    const { seller, reader } = this.resolveContext(user, organization);

    const problem = this.validate(seller);
    if (problem) {
      const error = new Error(problem.error);
      error.status = problem.status;
      error.code = problem.code;
      throw error;
    }

    const existing = await this.findForAccount({ user, organization, company });

    // Somebody got here first and the pipeline is still going. Handing back the
    // run already under way is the whole point: two people pressing Add within
    // a minute of each other should wait on one report, not race two.
    if (existing && this.isRunning(existing)) {
      existing.joinedExistingRun = true;
      return existing;
    }

    // A finished report has content worth protecting while the new pass runs.
    // A failed or interrupted one has nothing to lose, so it simply goes back
    // to 'pending' and reads as a first generation to everything downstream.
    const inPlace = Boolean(existing) && existing.status === 'complete';
    const report = existing || new Report({
      companyId: company._id,
      companyName: company.name,
      ticker: company.ticker,
      organizationId: organization?._id,
      userId: user._id,
    });

    if (inPlace) {
      report.refresh = {
        status: 'pending',
        step: 'Queued',
        percent: 5,
        startedAt: new Date(),
        requestedBy: user._id,
        error: undefined,
      };
    } else {
      // Re-running a report that never landed reuses its document, so the
      // identity fields are restated here - an account renamed or given a
      // ticker since would otherwise keep the old one forever.
      report.companyName = company.name;
      report.ticker = company.ticker;
      report.status = 'pending';
      report.progress = { step: 'Queued', percent: 5 };
      report.error = undefined;
      report.refresh = undefined;
      report.generatedAt = new Date();
      report.accountAddedAt = company.addedAt;
      // Stamped up front, not on completion: the lens is known the moment the
      // report is requested, and the reports list filters on it. Writing it only
      // on success left every pending and failed report with no vertical.
      report.context = this.buildContextStamp(seller);
      // Backfilled rather than reassigned: an org added after the report was
      // written should pull it into the tenant, but a rewrite must not hand a
      // colleague's report over to whoever pressed the button.
      if (!report.organizationId && organization?._id) report.organizationId = organization._id;
      if (!report.userId) report.userId = user._id;
    }

    await report.save();

    // A report being re-run after an interrupted rewrite still carries that
    // rewrite's marker, and a nested path is not cleared by assignment - see
    // the matching $unset at the end of run()
    if (!inPlace && existing) {
      await Report.updateOne({ _id: report._id }, { $unset: { refresh: '' } }).catch(() => {});
    }

    setImmediate(() => {
      this.run(report, { company, seller, reader, user, organization, inPlace }).catch(async (error) => {
        console.error('❌ Report generation failed:', error);

        // Written with updateOne rather than report.save(): if the failure was a
        // validation error the in-memory document is still invalid, so saving it
        // would fail too and leave the report stuck on "pending" forever.
        //
        // A failed rewrite never touches the report itself. What the team could
        // read a minute ago is still the best thing we have on the account, and
        // replacing it with an error page would be a worse outcome than the
        // stale date it now carries.
        await Report.updateOne(
          { _id: report._id },
          {
            $set: inPlace
              ? {
                  'refresh.status': 'failed',
                  'refresh.step': 'Failed',
                  'refresh.percent': 100,
                  'refresh.error': error.message?.slice(0, 500) || 'Report refresh failed',
                }
              : {
                  status: 'failed',
                  error: error.message?.slice(0, 500) || 'Report generation failed',
                  progress: { step: 'Failed', percent: 100 },
                },
          }
        ).catch((e) => console.error('❌ Could not record the failure:', e.message));

        // The request that asked for this report was logged when it returned
        // its 202, but generation runs long after that response. Without this
        // the audit trail shows reports being started and never says whether
        // any of them landed.
        activityLog.record({
          organization,
          user,
          action: 'report.failed',
          category: 'reports',
          outcome: 'failure',
          description: inPlace
            ? `The refresh of the ${company.name} report did not finish — the previous one is unchanged`
            : `The report on ${company.name} did not finish`,
          target: { type: 'report', id: String(report._id), label: company.name },
          metadata: { reason: error.message?.slice(0, 300) },
        });
      });
    });

    return report;
  }

  /**
   * The pipeline itself. Persists progress so the UI can show a live step.
   *
   * `inPlace` means this is a rewrite of a report that is currently readable:
   * progress is written to `refresh` and nothing on the report itself changes
   * until the whole pass has succeeded.
   */
  async run(report, { company, seller, reader, user, organization, inPlace = false }) {
    console.log(`\n📄 Generating report for ${company.name} (lens: ${seller.focusTerms?.join(', ') || 'capabilities only'})`);

    // Progress is written straight to the collection. Firing report.save() while
    // the pipeline is mid-flight would race the final save and can throw a
    // VersionError on the document that carries the actual analysis.
    //
    // A rewrite reports against `refresh` and leaves `progress` alone: that
    // field describes the run that produced what is on screen, and moving it
    // back to 5% would make a finished report render as a half-written one.
    const setProgress = (step, percent) => {
      if (inPlace) {
        report.refresh = { ...(report.refresh?.toObject?.() ?? report.refresh), step, percent };
        Report.updateOne(
          { _id: report._id },
          { $set: { 'refresh.step': step, 'refresh.percent': percent } }
        ).catch(() => {});
        return;
      }

      report.progress = { step, percent };
      Report.updateOne({ _id: report._id }, { $set: { progress: { step, percent } } }).catch(() => {});
    };

    // The cover is assembled straight off the company record, so anything the
    // record is missing is simply absent from the report. Repair it first -
    // accounts added before firmographics were fetched have no headcount,
    // headquarters or revenue at all.
    setProgress('Checking account details', 5);
    await companyDataFetcher.backfill(company).catch(error => {
      console.warn(`⚠️ Firmographics backfill skipped for ${company.name}: ${error.message}`);
    });

    // Which vertical trade press, regulator feeds, patent and contract lookups
    // run for this account. Accounts added before tagging existed have none, so
    // they are derived here from whatever the firmographics backfill just
    // resolved - a hand-set tag is never overwritten.
    if (accountTagging.backfill(company)) {
      await company.save().catch(() => {});
      console.log(`   ↳ Tagged as ${company.tags.vertical || 'untagged'}` +
        `${company.tags.regulated ? ', regulated' : ''}` +
        `${company.tags.governmentFacing ? ', government-facing' : ''}` +
        `${company.tags.rndHeavy ? ', R&D-heavy' : ''}`);
    }

    // The tenant's own CRM, when one is connected. contextFor never throws: a
    // CRM outage degrades the report to public evidence instead of failing it.
    setProgress('Reading your CRM', 8);
    const crm = await crmService.contextFor(organization, company);
    if (crm) {
      console.log(`   ↳ CRM matched: ${crm.openOpportunities?.length || 0} open deal(s), ${crm.contacts?.length || 0} contact(s)`);
    }

    const result = await intelligenceService.buildIntelligence({
      company,
      seller,
      crm,
      onProgress: setProgress,
    });

    report.context = this.buildContextStamp(seller);
    report.score = result.score;
    report.fastFacts = this.buildFastFacts(company, result.evidence.financial);
    report.quickLinks = this.buildQuickLinks(company);
    report.executiveBrief = result.sections.executiveBrief;
    report.research = result.sections.research;
    report.value = result.sections.value;
    report.whitespace = result.sections.whitespace;
    // The verified records the renderers draw directly, with no model in the
    // path between the primary source and the page
    report.evidence = result.records;
    report.coverage = result.coverage;
    report.sources = result.sources;
    // Which provider actually served this report - it may have failed over to
    // the fallback part-way through, and the report should say so.
    report.aiModel = aiEngine.lastModel;
    report.lastUpdatedAt = new Date();

    setProgress('Rendering PDF', 95);
    // Every render writes its own timestamped file, so a rewrite would leave the
    // one it replaced on disk forever
    const supersededPdf = inPlace ? report.pdfPath : null;
    const { filePath, fileName } = await reportGenerator.generate(report, { seller, reader, company });

    report.pdfPath = filePath;
    report.pdfFileName = fileName;
    report.status = 'complete';
    report.progress = { step: 'Done', percent: 100 };
    report.error = undefined;

    if (inPlace) {
      // A rewrite is a fresh generation: the reports list sorts and dates on
      // this, and leaving it at the original run would file today's research
      // under the day a colleague first looked at the account.
      report.generatedAt = new Date();
      report.accountAddedAt = company.addedAt || report.accountAddedAt;
    }

    await report.save();

    // The rewrite has landed, so this is simply the report again. Cleared with
    // $unset rather than by assignment: Mongoose does not remove a nested path
    // from the document when it is set to undefined, so the marker would be
    // saved straight back and the UI would spin on a finished report.
    if (inPlace) {
      await Report.updateOne({ _id: report._id }, { $unset: { refresh: '' } }).catch(() => {});
      report.refresh = undefined;
    }

    if (supersededPdf && supersededPdf !== filePath && fs.existsSync(supersededPdf)) {
      fs.unlink(supersededPdf, () => {});
    }

    if (user) {
      await new Inbox({
        userId: user._id,
        companyId: company._id,
        // Addressed to whoever asked for this run, which on a rewrite is not
        // the report's author - so it has to say which of the two happened
        title: inPlace ? `Report refreshed: ${company.name}` : `Report ready: ${company.name}`,
        message: inPlace
          ? `The ${company.name} report has been rewritten with the latest news, filings and hiring activity.`
          : `Your ${seller.priorityTopics?.length ? `${seller.priorityTopics.join(' / ')} ` : ''}intelligence report for ${company.name} is ready.`,
        type: 'report_ready',
        relatedReportId: report._id,
        actionUrl: `/reports/${report._id}`,
        actionText: 'View report',
      }).save().catch(() => {});
    }

    activityLog.record({
      organization,
      user,
      action: 'report.complete',
      category: 'reports',
      description: `The report on ${company.name} ${inPlace ? 'was refreshed' : 'finished'}${
        report.score?.value != null ? ` with a fit score of ${report.score.value}` : ''
      }`,
      target: { type: 'report', id: String(report._id), label: company.name },
      metadata: { score: report.score?.value, model: report.aiModel },
    });

    console.log(`✅ Report complete for ${company.name}`);
    return report;
  }
}

module.exports = new ReportService();
