const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Design tokens - kept in one place so the PDF and the web report stay in step
// ---------------------------------------------------------------------------
const PAGE = { width: 841.89, height: 595.28 }; // A4 landscape
const MARGIN = 52;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;
const BODY_TOP = 92;
const BODY_BOTTOM = PAGE.height - 78;

const C = {
  page: '#f8fafc',
  ink: '#0f172a',
  body: '#334155',
  muted: '#94a3b8',
  line: '#e2e8f0',
  brand: '#1d4ed8',
  brandDark: '#0f2f6b',
  link: '#2563eb',
  amber: '#f59e0b',
  green: '#059669',
  red: '#dc2626',
  purple: '#7c3aed',
  teal: '#0891b2',
  white: '#ffffff',
};

const F = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
  italic: 'Helvetica-Oblique',
};

// Only the symbols WinAnsi - the encoding pdfkit's core fonts use - can render.
// Anything else falls back to the ISO code, which is legible in every font.
const CURRENCY_SYMBOLS = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: '¥',
};

class ReportGenerator {
  constructor() {
    this.reportsDir = path.join(__dirname, '../../reports');
    if (!fs.existsSync(this.reportsDir)) {
      fs.mkdirSync(this.reportsDir, { recursive: true });
    }
  }

  // =========================================================================
  // Entry point
  // =========================================================================

  /**
   * @param {object} report  the saved Report document (or a plain equivalent)
   * @param {object} meta    { company, seller, reader }
   */
  async generate(report, meta = {}) {
    const fileName = `salesmotion-${this.slug(report.companyName)}-${Date.now()}.pdf`;
    const filePath = path.join(this.reportsDir, fileName);

    const doc = new PDFDocument({
      size: [PAGE.width, PAGE.height],
      // Margins are set to the body box so pdfkit's own overflow break resumes
      // below the running header instead of underneath it
      margins: {
        top: BODY_TOP,
        bottom: PAGE.height - BODY_BOTTOM,
        left: MARGIN,
        right: MARGIN,
      },
      bufferPages: true,
      info: {
        Title: `${report.companyName} — Sales Intelligence Report`,
        Author: meta.seller?.name || 'SalesMotion',
        Subject: 'Account intelligence brief',
      },
    });

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // ctx carries the running header label so chrome can be redrawn on breaks
    const ctx = {
      group: '',
      company: report.companyName,
      date: this.formatDate(report.generatedAt || new Date()),
      firstPage: true,
    };

    // A paragraph longer than the remaining space makes pdfkit add a page by
    // itself. Without this hook those pages would have no background, header or
    // footer. Cursor position is restored so the interrupted text flows on.
    doc.on('pageAdded', () => this.drawChrome(doc, ctx));

    this.coverPage(doc, ctx, report, meta);

    this.startGroup(doc, ctx, 'What You Need To Know');
    this.executiveBriefPages(doc, ctx, report);

    this.startGroup(doc, ctx, 'Research & Analysis');
    this.researchPages(doc, ctx, report);

    this.startGroup(doc, ctx, 'Value');
    this.valuePages(doc, ctx, report);

    this.startGroup(doc, ctx, 'Sources');
    this.sourcesPage(doc, ctx, report);

    doc.end();

    return new Promise((resolve, reject) => {
      stream.on('finish', () => resolve({ filePath, fileName }));
      stream.on('error', reject);
    });
  }

  // =========================================================================
  // Page chrome
  // =========================================================================

  /**
   * Draws background, header and footer for the current page.
   *
   * The footer sits below the bottom margin, and pdfkit breaks to a new page
   * for any text past that line - which would recurse through `pageAdded`
   * forever. Dropping the margins for the duration keeps the chrome outside
   * that machinery, and the cursor is restored so an interrupted paragraph
   * carries on where it left off.
   */
  drawChrome(doc, ctx) {
    const { x, y } = doc;
    const margins = doc.page.margins;
    const saved = { top: margins.top, bottom: margins.bottom };

    margins.top = 0;
    margins.bottom = 0;

    this.paintBackground(doc);
    this.drawHeader(doc, ctx);
    this.drawFooter(doc, ctx);

    margins.top = saved.top;
    margins.bottom = saved.bottom;
    doc.x = x;
    doc.y = y;
  }

  paintBackground(doc) {
    doc.save();
    doc.rect(0, 0, PAGE.width, PAGE.height).fill(C.page);
    doc.restore();
  }

  drawHeader(doc, ctx) {
    if (!ctx.group) return;

    doc.save();
    doc.font(F.regular).fontSize(9).fillColor(C.muted);
    doc.text(ctx.group, MARGIN, 40, { width: CONTENT_WIDTH / 2, lineBreak: false });
    doc.text(ctx.company, MARGIN + CONTENT_WIDTH / 2, 40, {
      width: CONTENT_WIDTH / 2,
      align: 'right',
      lineBreak: false,
    });
    doc.restore();
  }

  drawFooter(doc, ctx) {
    const y = PAGE.height - 62;

    doc.save();
    doc.moveTo(MARGIN, y).lineTo(PAGE.width - MARGIN, y).lineWidth(0.75).strokeColor(C.line).stroke();

    // Two-tone wordmark + the overlapping dots from the product logo
    const baseY = y + 16;
    doc.font(F.bold).fontSize(11);
    doc.fillColor(C.brandDark).text('sales', MARGIN, baseY, { lineBreak: false, continued: true });
    doc.fillColor(C.brand).text('motion', { lineBreak: false });

    const dotX = MARGIN + doc.widthOfString('salesmotion') + 10;
    doc.circle(dotX, baseY + 4, 5.5).fill(C.brandDark);
    doc.circle(dotX + 8, baseY + 4, 5.5).fillOpacity(0.85).fill(C.brand);
    doc.fillOpacity(1);

    doc.font(F.regular).fontSize(9).fillColor(C.muted);
    doc.text(ctx.date, PAGE.width - MARGIN - 220, baseY + 1, {
      width: 220,
      align: 'right',
      lineBreak: false,
    });
    doc.restore();
  }

  page(doc, ctx) {
    if (ctx.firstPage) {
      // The first page is never "added", so it needs its chrome drawn directly
      ctx.firstPage = false;
      this.drawChrome(doc, ctx);
    } else {
      doc.addPage(); // the pageAdded hook draws the chrome
    }

    doc.x = MARGIN;
    doc.y = ctx.group ? BODY_TOP : MARGIN;
    return doc;
  }

  // Break to a new page when the next block will not fit
  ensure(doc, ctx, needed) {
    if (doc.y + needed > BODY_BOTTOM) {
      this.page(doc, ctx);
      return true;
    }
    return false;
  }

  startGroup(doc, ctx, label) {
    ctx.group = label;
    this.page(doc, ctx);
  }

  // =========================================================================
  // Typography helpers
  // =========================================================================

  slug(value) {
    return String(value || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  formatDate(date) {
    return new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  // Amounts carry the currency they were reported in; only market cap, which
  // arrives from Finnhub already converted, keeps the dollar default.
  money(value, currency) {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    if (Number.isNaN(n)) return null;

    const symbol = currency ? (CURRENCY_SYMBOLS[currency] || `${currency} `) : '$';

    if (Math.abs(n) >= 1e12) return `${symbol}${(n / 1e12).toFixed(2)}T`;
    if (Math.abs(n) >= 1e9) return `${symbol}${(n / 1e9).toFixed(2)}B`;
    if (Math.abs(n) >= 1e6) return `${symbol}${(n / 1e6).toFixed(1)}M`;
    return `${symbol}${n.toLocaleString()}`;
  }

  h1(doc, ctx, text) {
    this.ensure(doc, ctx, 60);
    doc.font(F.bold).fontSize(20).fillColor(C.ink)
      .text(text, MARGIN, doc.y, { width: CONTENT_WIDTH });
    doc.moveDown(0.55);
  }

  h2(doc, ctx, text, color = C.ink) {
    this.ensure(doc, ctx, 52);
    doc.font(F.bold).fontSize(12.5).fillColor(color)
      .text(text, MARGIN, doc.y, { width: CONTENT_WIDTH });
    doc.moveDown(0.35);
  }

  h3(doc, ctx, text, color = C.brand) {
    this.ensure(doc, ctx, 44);
    doc.font(F.bold).fontSize(10).fillColor(color)
      .text(String(text).toUpperCase(), MARGIN, doc.y, { width: CONTENT_WIDTH, characterSpacing: 0.6 });
    doc.moveDown(0.3);
  }

  /**
   * One evidence-backed line: coloured marker, wrapped body text, then the
   * citation chips the sample decks put at the end of each claim.
   */
  bullet(doc, ctx, item, { color = C.brand, indent = 16, size = 9.5 } = {}) {
    const text = typeof item === 'string' ? item : item?.text;
    if (!text) return;

    const citations = (typeof item === 'object' && Array.isArray(item.citations)) ? item.citations : [];
    const textWidth = CONTENT_WIDTH - indent;

    doc.font(F.regular).fontSize(size);
    const height = doc.heightOfString(text, { width: textWidth, lineGap: 1.6 });
    this.ensure(doc, ctx, Math.min(height + 14, 160));

    const top = doc.y;

    // Marker
    doc.save();
    doc.circle(MARGIN + 4, top + 5.2, 3).fill(color);
    doc.restore();

    doc.fillColor(C.body).font(F.regular).fontSize(size)
      .text(text, MARGIN + indent, top, {
        width: textWidth,
        lineGap: 1.6,
        continued: citations.length > 0,
      });

    if (citations.length) {
      doc.font(F.bold).fontSize(7).fillColor(C.link)
        .text(`  ${citations.map(n => `[${n}]`).join(' ')}`, { lineGap: 1.6 });
    }

    doc.moveDown(0.42);
  }

  bulletList(doc, ctx, items, options = {}) {
    const list = (items || []).filter(Boolean);

    if (!list.length) {
      this.emptyNote(doc, ctx);
      return;
    }

    list.forEach(item => this.bullet(doc, ctx, item, options));
  }

  emptyNote(doc, ctx) {
    this.ensure(doc, ctx, 26);
    doc.font(F.italic).fontSize(9).fillColor(C.muted)
      .text('No supporting evidence was found for this section.', MARGIN + 16, doc.y, { width: CONTENT_WIDTH - 16 });
    doc.moveDown(0.5);
  }

  paragraph(doc, ctx, text, { size = 9.5, color = C.body, indent = 0 } = {}) {
    if (!text) return;
    doc.font(F.regular).fontSize(size);
    const height = doc.heightOfString(text, { width: CONTENT_WIDTH - indent, lineGap: 2 });
    this.ensure(doc, ctx, Math.min(height + 10, 200));
    doc.fillColor(color).text(text, MARGIN + indent, doc.y, { width: CONTENT_WIDTH - indent, lineGap: 2 });
    doc.moveDown(0.5);
  }

  rule(doc, gap = 0.6) {
    doc.moveDown(gap * 0.5);
    doc.save()
      .moveTo(MARGIN, doc.y).lineTo(PAGE.width - MARGIN, doc.y)
      .lineWidth(0.75).strokeColor(C.line).stroke()
      .restore();
    doc.moveDown(gap);
  }

  // Card used for quotes and callouts
  card(doc, ctx, render, { height, fill = '#eef2f7', accent } = {}) {
    this.ensure(doc, ctx, height + 12);
    const top = doc.y;

    doc.save();
    doc.roundedRect(MARGIN, top, CONTENT_WIDTH, height, 6).fill(fill);
    if (accent) {
      doc.roundedRect(MARGIN, top, 3.5, height, 2).fill(accent);
    }
    doc.restore();

    render(top);
    doc.y = top + height + 12;
  }

  // =========================================================================
  // Cover
  // =========================================================================

  coverPage(doc, ctx, report, meta) {
    ctx.group = '';
    this.page(doc, ctx);

    const facts = report.fastFacts || {};
    const leftWidth = CONTENT_WIDTH * 0.52;
    const rightX = MARGIN + CONTENT_WIDTH * 0.58;
    const rightWidth = CONTENT_WIDTH * 0.42;

    // --- Title block ---
    doc.font(F.bold).fontSize(34).fillColor(C.ink)
      .text(report.companyName, MARGIN, 62, { width: leftWidth });
    doc.font(F.regular).fontSize(12).fillColor(C.muted)
      .text(this.hostname(facts.website) || facts.industry || '', MARGIN, doc.y + 2, { width: leftWidth });

    // --- Score badge (top right) ---
    if (report.score?.value) {
      this.scoreBadge(doc, report.score, PAGE.width - MARGIN - 132, 58);
    }

    // --- Fast facts ---
    let y = 150;
    doc.font(F.bold).fontSize(14).fillColor(C.ink).text('Fast Facts', MARGIN, y, { width: leftWidth });
    y = doc.y + 8;

    if (facts.description) {
      doc.font(F.regular).fontSize(9.5).fillColor(C.body)
        .text(this.truncate(facts.description, 430), MARGIN, y, { width: leftWidth, lineGap: 2 });
      y = doc.y + 12;
    }

    // Read as sentences, the way the web cover does - "Headquartered in London,
    // United Kingdom" rather than a HEADQUARTERS label above a value
    const revenue = this.money(facts.revenue, facts.revenueCurrency);
    const lines = [
      facts.headquarters ? `Headquartered in ${facts.headquarters}` : null,
      facts.industry,
      revenue ? `${revenue} revenue${facts.revenueAsOf ? ` (FY${facts.revenueAsOf})` : ''}` : null,
      facts.employees ? `${Number(facts.employees).toLocaleString()} employees` : null,
      this.money(facts.marketCap) ? `${this.money(facts.marketCap)} market cap` : null,
      facts.founded ? `Founded ${facts.founded}` : null,
    ].filter(Boolean);

    lines.forEach(line => {
      // Stands in for the icon the web cover carries; PDF core fonts have none
      doc.circle(MARGIN + 2.5, y + 4.5, 2).fill(C.brand);
      doc.font(F.regular).fontSize(10).fillColor(C.ink)
        .text(line, MARGIN + 11, y, { width: leftWidth - 11 });
      y = doc.y + 5;
    });

    // --- Score narrative ---
    if (report.score?.summary || report.score?.value) {
      const line = report.score.summary
        || `${report.companyName} has a Salesmotion score of ${report.score.value}.`;
      doc.font(F.regular).fontSize(9.5).fillColor(C.body)
        .text(line, MARGIN, y + 6, { width: leftWidth, lineGap: 2 });
    }

    // --- Right column: quick links ---
    let ry = 150;
    doc.font(F.bold).fontSize(14).fillColor(C.ink).text('Quick Links', rightX, ry, { width: rightWidth });
    ry = doc.y + 8;

    // Reports written before the homepage was fetched hold it only in
    // fastFacts, so it is merged in rather than missing from the cover
    const links = [...(report.quickLinks || [])];
    if (facts.website && !links.some(l => this.hostname(l.url) === this.hostname(facts.website))) {
      links.unshift({ label: this.hostname(facts.website), url: facts.website });
    }

    links.slice(0, 6).forEach(link => {
      doc.font(F.regular).fontSize(10).fillColor(C.link)
        .text(link.label, rightX, ry, { width: rightWidth, link: link.url, underline: false });
      ry = doc.y + 5;
    });

    // Ticker and market cap are not repeated here - the Yahoo Finance link
    // above carries the symbol, and the cap is one of the fast facts.

    // --- Right column: report context (the lens this report was written with) ---
    ry += 14;
    doc.font(F.bold).fontSize(14).fillColor(C.ink).text('Report Context', rightX, ry, { width: rightWidth });
    ry = doc.y + 8;

    const context = report.context || {};
    const contextRows = [
      ['Prepared for', context.sellerName || meta.seller?.name],
      ['Priority topics', (context.priorityTopics || []).join(', ')],
      ['Other topics', (context.topics || []).slice(0, 6).join(', ')],
      ['Capabilities', (context.sellerCapabilities || []).slice(0, 4).join(', ')],
      ['Account added', this.day(report.accountAddedAt || meta.company?.addedAt)],
      // Regenerating writes a new report, so for this one the two are minutes
      // apart; lastUpdatedAt is when the pipeline finished writing it
      ['Last refreshed', this.moment(report.lastUpdatedAt || report.generatedAt)],
    ].filter(([, value]) => value);

    contextRows.forEach(([label, value]) => {
      doc.font(F.bold).fontSize(8).fillColor(C.muted)
        .text(label.toUpperCase(), rightX, ry, { width: rightWidth, characterSpacing: 0.5 });
      doc.font(F.regular).fontSize(9.5).fillColor(C.ink)
        .text(value, rightX, doc.y + 1, { width: rightWidth, lineGap: 1.5 });
      ry = doc.y + 8;
    });
  }

  scoreBadge(doc, score, x, y) {
    const size = 116;
    const colour =
      score.value >= 80 ? C.green :
      score.value >= 60 ? C.brand :
      score.value >= 40 ? C.amber : C.muted;

    doc.save();
    doc.roundedRect(x, y, size, size, 12).fill(C.white);
    doc.roundedRect(x, y, size, size, 12).lineWidth(1).strokeColor(C.line).stroke();

    doc.font(F.bold).fontSize(38).fillColor(colour)
      .text(String(score.value), x, y + 22, { width: size, align: 'center' });
    doc.font(F.bold).fontSize(8).fillColor(C.ink)
      .text((score.band || '').toUpperCase(), x, y + 66, { width: size, align: 'center', characterSpacing: 0.8 });
    doc.font(F.regular).fontSize(7.5).fillColor(C.muted)
      .text('SALESMOTION SCORE', x, y + 82, { width: size, align: 'center', characterSpacing: 0.4 });
    doc.restore();
  }

  hostname(url) {
    if (!url) return '';
    return String(url).replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }

  day(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  // A report can be regenerated more than once in a day, so "last refreshed"
  // only means something with the time on it
  moment(value) {
    const date = this.day(value);
    if (!date) return null;
    const time = new Date(value)
      .toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return `${date} at ${time}`;
  }

  truncate(text, max) {
    const clean = String(text).replace(/\s+/g, ' ').trim();
    return clean.length > max ? `${clean.slice(0, max).trim()}…` : clean;
  }

  // =========================================================================
  // Group 1 — What You Need To Know
  // =========================================================================

  executiveBriefPages(doc, ctx, report) {
    const brief = report.executiveBrief || {};

    this.h1(doc, ctx, 'Key Insights');
    this.bulletList(doc, ctx, brief.keyInsights, { color: C.amber });

    this.h1(doc, ctx, 'Opportunities');
    this.bulletList(doc, ctx, brief.opportunities, { color: C.green });

    this.h1(doc, ctx, 'Challenges');
    this.bulletList(doc, ctx, brief.challenges, { color: C.red });

    this.h1(doc, ctx, 'People Updates');
    this.bulletList(doc, ctx, brief.peopleUpdates, { color: C.purple });

    this.h1(doc, ctx, 'Top News');
    this.newsList(doc, ctx, brief.topNews);

    this.h1(doc, ctx, 'Talking Points');
    this.bulletList(doc, ctx, brief.talkingPoints, { color: C.brand });

    if (brief.executivePerspective?.length) {
      this.h1(doc, ctx, 'Executive Perspective');
      brief.executivePerspective.forEach(q => this.quoteCard(doc, ctx, q));
    }
  }

  newsList(doc, ctx, news) {
    const list = (news || []).filter(n => n?.title);

    if (!list.length) {
      this.emptyNote(doc, ctx);
      return;
    }

    list.forEach(item => {
      doc.font(F.bold).fontSize(9.5);
      const titleHeight = doc.heightOfString(item.title, { width: CONTENT_WIDTH - 16 });
      this.ensure(doc, ctx, titleHeight + 46);

      const top = doc.y;
      doc.save().circle(MARGIN + 4, top + 5, 3).fill(C.teal).restore();

      doc.font(F.bold).fontSize(9.5).fillColor(C.ink)
        .text(item.title, MARGIN + 16, top, { width: CONTENT_WIDTH - 16, link: item.url || undefined });

      if (item.summary) {
        doc.font(F.regular).fontSize(9).fillColor(C.body)
          .text(this.truncate(item.summary, 260), MARGIN + 16, doc.y + 2, { width: CONTENT_WIDTH - 16, lineGap: 1.5 });
      }

      const meta = [item.source, item.publishedAt ? this.formatDate(item.publishedAt) : null]
        .filter(Boolean).join('  ·  ');
      if (meta) {
        doc.font(F.regular).fontSize(7.5).fillColor(C.muted)
          .text(meta, MARGIN + 16, doc.y + 2, { width: CONTENT_WIDTH - 16 });
      }

      doc.moveDown(0.6);
    });
  }

  quoteCard(doc, ctx, quote) {
    const width = CONTENT_WIDTH - 44;
    doc.font(F.italic).fontSize(10.5);
    const quoteHeight = doc.heightOfString(`"${quote.quote}"`, { width, lineGap: 2 });
    const height = quoteHeight + 44;

    this.card(doc, ctx, (top) => {
      doc.font(F.italic).fontSize(10.5).fillColor(C.ink)
        .text(`"${quote.quote}"`, MARGIN + 22, top + 14, { width, lineGap: 2 });

      const attribution = [quote.person, quote.title, quote.source].filter(Boolean).join(', ');
      doc.font(F.regular).fontSize(8.5).fillColor(C.muted)
        .text(`— ${attribution}`, MARGIN + 22, top + height - 22, { width, lineBreak: false });
    }, { height, accent: C.brand });
  }

  // =========================================================================
  // Group 2 — Research & Analysis
  // =========================================================================

  researchPages(doc, ctx, report) {
    const r = report.research || {};

    this.h1(doc, ctx, 'Insights');
    this.subsection(doc, ctx, 'Company Overview', r.companyOverview);
    this.subsection(doc, ctx, 'Key People Changes', r.keyPeopleChanges);
    this.subsection(doc, ctx, 'Key Projects', r.keyProjects);
    this.subsection(doc, ctx, 'Aspirations', r.aspirations);
    this.subsection(doc, ctx, 'Business Goals', r.businessGoals);
    this.subsection(doc, ctx, 'Opportunities', r.opportunities);
    this.subsection(doc, ctx, 'Macroeconomic Perspective', r.macroPerspective);
    this.subsection(doc, ctx, 'Recent Press Announcements', r.recentPress);

    this.page(doc, ctx);
    this.h1(doc, ctx, 'Business Model');
    this.subsection(doc, ctx, 'Revenue Streams', r.businessModel?.revenueStreams);
    this.subsection(doc, ctx, 'Go-to-Market Strategy', r.businessModel?.goToMarket);
    this.subsection(doc, ctx, 'Ideal Customer Profile', r.businessModel?.idealCustomerProfile);

    this.h1(doc, ctx, 'Strategic Initiatives');
    this.bulletList(doc, ctx, r.strategicInitiatives, { color: C.brand });

    this.h1(doc, ctx, 'Financials');
    this.bulletList(doc, ctx, r.financials, { color: C.teal });

    this.page(doc, ctx);
    this.h1(doc, ctx, 'SWOT Analysis');
    this.subsection(doc, ctx, 'Strengths', r.swot?.strengths, C.green);
    this.subsection(doc, ctx, 'Weaknesses', r.swot?.weaknesses, C.red);
    this.subsection(doc, ctx, 'Opportunities', r.swot?.opportunities, C.brand);
    this.subsection(doc, ctx, 'Threats', r.swot?.threats, C.amber);
  }

  subsection(doc, ctx, title, items, color = C.brand) {
    this.h3(doc, ctx, title, color);
    this.bulletList(doc, ctx, items, { color });
    doc.moveDown(0.35);
  }

  // =========================================================================
  // Group 3 — Value
  // =========================================================================

  valuePages(doc, ctx, report) {
    const v = report.value || {};

    this.h1(doc, ctx, 'Three Whys');
    this.subsection(doc, ctx, 'Why Change', v.whyChange, C.purple);
    this.subsection(doc, ctx, 'Why Now', v.whyNow, C.amber);
    this.subsection(doc, ctx, 'Why You', v.whyYou, C.green);

    this.page(doc, ctx);
    this.h1(doc, ctx, 'Value Pyramid');
    this.subsection(doc, ctx, 'Company Goals', v.valuePyramid?.companyGoals);
    this.subsection(doc, ctx, 'Business Strategy', v.valuePyramid?.businessStrategy);
    this.subsection(doc, ctx, 'Challenges and Obstacles', v.valuePyramid?.challengesObstacles, C.red);
    this.subsection(doc, ctx, 'Value Paths', v.valuePyramid?.valuePaths, C.teal);

    if (v.valuePropositions?.length) {
      this.page(doc, ctx);
      this.h1(doc, ctx, 'Value Proposition Ideas');

      v.valuePropositions.forEach((prop, idx) => {
        this.ensure(doc, ctx, 90);
        doc.font(F.bold).fontSize(10.5).fillColor(C.ink)
          .text(`${idx + 1}. ${prop.title}`, MARGIN, doc.y, { width: CONTENT_WIDTH });
        doc.moveDown(0.25);
        this.paragraph(doc, ctx, prop.body, { indent: 16 });

        if (prop.citations?.length) {
          doc.font(F.bold).fontSize(7).fillColor(C.link)
            .text(prop.citations.map(n => `[${n}]`).join(' '), MARGIN + 16, doc.y - 4, { width: CONTENT_WIDTH - 16 });
        }
        doc.moveDown(0.5);
      });
    }

    this.h1(doc, ctx, 'Value Hypothesis');
    this.bulletList(doc, ctx, v.hypotheses, { color: C.purple });

    this.h1(doc, ctx, 'Point of View');
    this.bulletList(doc, ctx, v.pointOfView, { color: C.brand });
  }

  // =========================================================================
  // Sources
  // =========================================================================

  sourcesPage(doc, ctx, report) {
    this.h1(doc, ctx, 'Sources');

    const sources = report.sources || [];
    if (!sources.length) {
      this.emptyNote(doc, ctx);
      return;
    }

    doc.font(F.regular).fontSize(9).fillColor(C.muted)
      .text('Numbered references cited throughout this report.', MARGIN, doc.y, { width: CONTENT_WIDTH });
    doc.moveDown(0.8);

    sources.forEach(source => {
      doc.font(F.regular).fontSize(8.5);
      const height = doc.heightOfString(source.title || '', { width: CONTENT_WIDTH - 34 });
      this.ensure(doc, ctx, height + 22);

      const top = doc.y;
      doc.font(F.bold).fontSize(8).fillColor(C.link)
        .text(`[${source.index}]`, MARGIN, top, { width: 28, lineBreak: false });

      doc.font(F.regular).fontSize(8.5).fillColor(C.body)
        .text(source.title || 'Untitled', MARGIN + 30, top, {
          width: CONTENT_WIDTH - 34,
          link: source.url || undefined,
        });

      const meta = [
        source.source,
        source.publishedAt ? this.formatDate(source.publishedAt) : null,
        source.type,
      ].filter(Boolean).join('  ·  ');

      doc.font(F.regular).fontSize(7.5).fillColor(C.muted)
        .text(meta, MARGIN + 30, doc.y + 1, { width: CONTENT_WIDTH - 34 });

      doc.moveDown(0.45);
    });
  }
}

module.exports = new ReportGenerator();
