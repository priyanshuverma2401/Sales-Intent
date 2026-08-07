const Report = require('../models/Report');
const Inbox = require('../models/Inbox');
const intelligenceService = require('./intelligenceService');
const reportGenerator = require('./reportGenerator');
const aiEngine = require('./aiEngine');
const crmService = require('./crm');
const companyDataFetcher = require('./dataFetchers/companyDataFetcher');

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
    links.push({
      label: 'Crunchbase',
      url: `https://www.crunchbase.com/textsearch?q=${encodeURIComponent(company.name)}`,
    });
    links.push({
      label: 'LinkedIn',
      url: `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(company.name)}`,
    });

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
   * Creates the pending Report, returns it immediately, and finishes the work in
   * the background so the request does not block on ~60s of AI calls.
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

    const report = new Report({
      companyId: company._id,
      companyName: company.name,
      ticker: company.ticker,
      organizationId: organization?._id,
      userId: user._id,
      status: 'pending',
      progress: { step: 'Queued', percent: 5 },
      generatedAt: new Date(),
      accountAddedAt: company.addedAt,
      // Stamped up front, not on completion: the lens is known the moment the
      // report is requested, and the reports list filters on it. Writing it only
      // on success left every pending and failed report with no vertical.
      context: this.buildContextStamp(seller),
    });
    await report.save();

    setImmediate(() => {
      this.run(report, { company, seller, reader, user, organization }).catch(async (error) => {
        console.error('❌ Report generation failed:', error);

        // Written with updateOne rather than report.save(): if the failure was a
        // validation error the in-memory document is still invalid, so saving it
        // would fail too and leave the report stuck on "pending" forever.
        await Report.updateOne(
          { _id: report._id },
          {
            $set: {
              status: 'failed',
              error: error.message?.slice(0, 500) || 'Report generation failed',
              progress: { step: 'Failed', percent: 100 },
            },
          }
        ).catch((e) => console.error('❌ Could not record the failure:', e.message));
      });
    });

    return report;
  }

  /** The pipeline itself. Persists progress so the UI can show a live step. */
  async run(report, { company, seller, reader, user, organization }) {
    console.log(`\n📄 Generating report for ${company.name} (lens: ${seller.focusTerms?.join(', ') || 'capabilities only'})`);

    // Progress is written straight to the collection. Firing report.save() while
    // the pipeline is mid-flight would race the final save and can throw a
    // VersionError on the document that carries the actual analysis.
    const setProgress = (step, percent) => {
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
    report.sources = result.sources;
    // Which provider actually served this report - it may have failed over to
    // the fallback part-way through, and the report should say so.
    report.aiModel = aiEngine.lastModel;
    report.lastUpdatedAt = new Date();

    setProgress('Rendering PDF', 95);
    const { filePath, fileName } = await reportGenerator.generate(report, { seller, reader, company });

    report.pdfPath = filePath;
    report.pdfFileName = fileName;
    report.status = 'complete';
    report.progress = { step: 'Done', percent: 100 };
    report.error = undefined;
    await report.save();

    if (user) {
      await new Inbox({
        userId: user._id,
        companyId: company._id,
        title: `Report ready: ${company.name}`,
        message: `Your ${seller.priorityTopics?.length ? `${seller.priorityTopics.join(' / ')} ` : ''}intelligence report for ${company.name} is ready.`,
        type: 'report_ready',
        relatedReportId: report._id,
        actionUrl: `/reports/${report._id}`,
        actionText: 'View report',
      }).save().catch(() => {});
    }

    console.log(`✅ Report complete for ${company.name}`);
    return report;
  }
}

module.exports = new ReportService();
