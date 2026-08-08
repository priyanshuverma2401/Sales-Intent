const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// The record formatters live with the extractors that produce them, so the PDF
// and the web report cannot drift into printing the same record two ways
const executiveMoves = require('./extractors/executiveMoves');
const contractFetcher = require('./dataFetchers/contractFetcher');
const patentFetcher = require('./dataFetchers/patentFetcher');
const { ACTION_LABELS: REGULATORY_LABELS } = require('./extractors/regulatoryActions');
const { CITATION_REASONS } = require('./intelligenceService');

// ---------------------------------------------------------------------------
// Design tokens.
//
// The layout follows the Salesmotion insights deck: A4 landscape, one
// full-width column read straight down the page, generous line spacing, an
// outline icon in front of every claim, and almost no chrome - a quiet running
// header, a single footer rule, nothing boxed that does not need a box.
// ---------------------------------------------------------------------------
const PAGE = { width: 841.89, height: 595.28 }; // A4 landscape

const MARGIN = 50;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;

const HEADER_Y = 36;
const BODY_TOP = 80;
const FOOTER_RULE_Y = PAGE.height - 56;
const BODY_BOTTOM = FOOTER_RULE_Y - 18;
const PAGE_CAP = BODY_BOTTOM - BODY_TOP;

const C = {
  page: '#f8fafc',
  ink: '#212b36',       // headings
  body: '#3b4757',      // running copy
  muted: '#98a1ac',     // header, footer, bylines
  line: '#e5e9ee',
  card: '#f1f3f6',      // quote cards
  track: '#e2e7ee',     // score bar track
  blue: '#2779c8',      // icons, links, citation chips, blue subheads
  brand: '#1d4ed8',     // wordmark
  brandDark: '#0f2f6b',
  amber: '#e8a33d',
  green: '#1f9d61',
  red: '#d9534f',
  purple: '#7c3aed',
  teal: '#0e7490',
  white: '#ffffff',
};

const F = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
  italic: 'Helvetica-Oblique',
};

// One body setting shared everywhere keeps the vertical rhythm even
const BODY_SIZE = 9.5;
const BODY_GAP = 3.2;

// Only the symbols WinAnsi - the encoding pdfkit's core fonts use - can render.
// Anything else falls back to the ISO code, which is legible in every font.
const CURRENCY_SYMBOLS = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: '¥',
};

const SCORE_LABELS = {
  keywordFit: 'Keyword fit',
  buyingSignals: 'Buying signals',
  hiringSignals: 'Hiring signals',
  newsMomentum: 'News momentum',
  financialContext: 'Financial context',
  crmSignals: 'CRM signals',
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

    const ctx = {
      group: '',
      company: report.companyName,
      date: this.formatDate(report.generatedAt || new Date()),
      firstPage: true,
      toc: [],
      tocPageIndex: null,
    };

    // A paragraph longer than the remaining space makes pdfkit add a page by
    // itself; this hook keeps that page furnished and lets the text carry on
    doc.on('pageAdded', () => this.drawChrome(doc, ctx));

    this.coverPage(doc, ctx, report, meta);
    this.contentsPlaceholder(doc, ctx);

    this.startGroup(doc, ctx, 'What You Need To Know');
    this.executiveBriefPages(doc, ctx, report);

    this.startGroup(doc, ctx, 'Research & Analysis');
    this.researchPages(doc, ctx, report);

    this.startGroup(doc, ctx, 'Value');
    this.valuePages(doc, ctx, report);

    this.startGroup(doc, ctx, 'Sources');
    this.sourcesPage(doc, ctx, report);
    this.reportContextSection(doc, ctx, report, meta);

    // Both passes reach back into earlier pages, so they run before the
    // buffer closes
    this.drawContents(doc, ctx);
    this.stampPageNumbers(doc, ctx);

    doc.end();

    return new Promise((resolve, reject) => {
      stream.on('finish', () => resolve({ filePath, fileName }));
      stream.on('error', reject);
    });
  }

  // =========================================================================
  // Page chrome
  // =========================================================================

  drawChrome(doc, ctx) {
    this.withoutMargins(doc, () => {
      this.paintBackground(doc);
      this.drawHeader(doc, ctx);
      this.drawFooter(doc, ctx);
    });
  }

  /**
   * The footer sits below the bottom margin, and pdfkit breaks to a new page
   * for any text past that line - which would recurse through `pageAdded`
   * forever. Dropping the margins for the duration keeps the chrome outside
   * that machinery, and the cursor is restored so an interrupted paragraph
   * carries on where it left off.
   */
  withoutMargins(doc, render) {
    const { x, y } = doc;
    const margins = doc.page.margins;
    const saved = { top: margins.top, bottom: margins.bottom };

    margins.top = 0;
    margins.bottom = 0;

    render();

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

  // Quiet, unruled, like the sample deck: group left, company right
  drawHeader(doc, ctx) {
    if (!ctx.group) return;

    doc.save();
    doc.font(F.regular).fontSize(9).fillColor(C.muted);
    doc.text(ctx.group, MARGIN, HEADER_Y, { width: CONTENT_WIDTH / 2, lineBreak: false });
    doc.text(ctx.company, MARGIN + CONTENT_WIDTH / 2, HEADER_Y, {
      width: CONTENT_WIDTH / 2,
      align: 'right',
      lineBreak: false,
    });
    doc.restore();
  }

  drawFooter(doc, ctx) {
    const y = FOOTER_RULE_Y;

    doc.save();
    doc.moveTo(MARGIN, y).lineTo(PAGE.width - MARGIN, y).lineWidth(0.75).strokeColor(C.line).stroke();

    // Two-tone wordmark + the overlapping dots from the product logo
    const baseY = y + 15;
    doc.font(F.bold).fontSize(10.5);
    doc.fillColor(C.brandDark).text('sales', MARGIN, baseY, { lineBreak: false, continued: true });
    doc.fillColor(C.brand).text('motion', { lineBreak: false });

    const dotX = MARGIN + doc.widthOfString('salesmotion') + 9;
    doc.circle(dotX, baseY + 4, 5).fill(C.brandDark);
    doc.circle(dotX + 7.5, baseY + 4, 5).fillOpacity(0.85).fill(C.brand);
    doc.fillOpacity(1);

    doc.font(F.regular).fontSize(8.5).fillColor(C.muted);
    doc.text(ctx.date, PAGE.width - MARGIN - 240, baseY + 2, {
      width: 240,
      align: 'right',
      lineBreak: false,
    });
    doc.restore();
  }

  // Page numbers need the total, which is only known once the last page exists
  stampPageNumbers(doc) {
    const range = doc.bufferedPageRange();
    const total = range.start + range.count;

    for (let i = range.start + 1; i < total; i++) {
      doc.switchToPage(i);
      this.withoutMargins(doc, () => {
        doc.save();
        doc.font(F.regular).fontSize(8).fillColor(C.muted)
          .text(`${i + 1} / ${total}`, MARGIN, FOOTER_RULE_Y + 17, {
            width: CONTENT_WIDTH,
            align: 'center',
            lineBreak: false,
          });
        doc.restore();
      });
    }
  }

  pageNumber(doc) {
    const range = doc.bufferedPageRange();
    return range.start + range.count;
  }

  // =========================================================================
  // Flow helpers
  // =========================================================================

  newPage(doc, ctx) {
    if (ctx.firstPage) {
      // The first page is never "added", so it needs its chrome drawn directly
      ctx.firstPage = false;
      this.drawChrome(doc, ctx);
    } else {
      doc.addPage(); // the pageAdded hook draws the chrome
    }

    doc.x = MARGIN;
    doc.y = BODY_TOP;
  }

  room(doc) {
    return BODY_BOTTOM - doc.y;
  }

  atTop(doc) {
    return doc.y <= BODY_TOP + 0.5;
  }

  // Break when the next block will not fit in what is left of the page
  ensure(doc, ctx, height) {
    if (height > this.room(doc)) {
      this.newPage(doc, ctx);
      return true;
    }
    return false;
  }

  /**
   * Places a block of known height without cutting it in half: one that would
   * straddle the fold moves whole to the next page. Only copy too tall for any
   * page is allowed to split, and then only with a few lines already placed.
   */
  fitBlock(doc, ctx, height, minLines = 3) {
    if (height <= this.room(doc)) return;

    if (height <= PAGE_CAP) {
      this.newPage(doc, ctx);
      return;
    }

    const line = this.lineHeight(doc, BODY_SIZE);
    if (this.room(doc) < line * minLines) this.newPage(doc, ctx);
  }

  space(doc, amount) {
    doc.y += amount;
  }

  startGroup(doc, ctx, label) {
    ctx.group = label;
    this.newPage(doc, ctx);
    ctx.toc.push({ level: 0, label, page: this.pageNumber(doc) });
  }

  lineHeight(doc, size, lineGap = BODY_GAP) {
    doc.fontSize(size);
    return doc.currentLineHeight(true) + lineGap;
  }

  /**
   * Wrapped height of a text block, citation chips included, so callers can
   * decide where it goes before anything is drawn.
   */
  flowHeight(doc, text, options = {}) {
    const {
      font = F.regular,
      size = BODY_SIZE,
      lineGap = BODY_GAP,
      indent = 0,
      citations = [],
    } = options;

    const value = String(text || '').trim();
    if (!value) return 0;

    doc.font(font).fontSize(size);
    const height = doc.heightOfString(value, { width: CONTENT_WIDTH - indent, lineGap });

    // Chips ride on the last line but can wrap onto one of their own
    return height + (citations.length ? this.lineHeight(doc, size, lineGap) * 0.4 : 0);
  }

  // Body text at the cursor; pdfkit wraps it and, for copy taller than the
  // page, breaks it - the pageAdded hook keeps those pages furnished
  writeText(doc, text, options = {}) {
    const {
      font = F.regular,
      size = BODY_SIZE,
      color = C.body,
      lineGap = BODY_GAP,
      indent = 0,
      link,
      citations = [],
    } = options;

    const value = String(text || '').trim();
    if (!value) return;

    // Chips ride the last line via `continued` - except on copy taller than a
    // page, where pdfkit's own break garbles the continued run; there the
    // chips take a line of their own instead
    doc.font(font).fontSize(size);
    const tooTall = doc.heightOfString(value, { width: CONTENT_WIDTH - indent, lineGap }) > PAGE_CAP;
    const inline = citations.length > 0 && !tooTall;

    doc.fillColor(color)
      .text(value, MARGIN + indent, doc.y, {
        width: CONTENT_WIDTH - indent,
        lineGap,
        link,
        continued: inline,
      });

    if (citations.length) {
      const chips = citations.map(n => `[${n}]`).join('  ');
      doc.font(F.bold).fontSize(7.2).fillColor(C.blue);
      if (inline) {
        doc.text(`  ${chips}`, { lineGap });
      } else {
        doc.text(chips, MARGIN + indent, doc.y + 2, { width: CONTENT_WIDTH - indent });
      }
    }
  }

  // =========================================================================
  // Icons
  //
  // The deck this design follows sets a small outline icon in front of every
  // claim. Core PDF fonts carry no icon glyphs, so these are drawn as paths.
  // =========================================================================

  drawIcon(doc, name, x, y, s, color) {
    doc.save();
    doc.lineWidth(Math.max(0.9, s * 0.09)).strokeColor(color).fillColor(color);
    doc.lineJoin('round').lineCap('round');

    const cx = x + s / 2;

    switch (name) {
      case 'bulb':
        doc.circle(cx, y + s * 0.34, s * 0.28).stroke();
        doc.moveTo(cx - s * 0.11, y + s * 0.62).lineTo(cx - s * 0.11, y + s * 0.8)
          .moveTo(cx + s * 0.11, y + s * 0.62).lineTo(cx + s * 0.11, y + s * 0.8)
          .moveTo(cx - s * 0.14, y + s * 0.9).lineTo(cx + s * 0.14, y + s * 0.9)
          .stroke();
        break;

      case 'case':
        doc.roundedRect(x + s * 0.06, y + s * 0.3, s * 0.88, s * 0.58, s * 0.1).stroke();
        doc.roundedRect(x + s * 0.33, y + s * 0.1, s * 0.34, s * 0.2, s * 0.06).stroke();
        doc.moveTo(x + s * 0.06, y + s * 0.55).lineTo(x + s * 0.94, y + s * 0.55).stroke();
        break;

      case 'person':
        doc.circle(cx, y + s * 0.26, s * 0.17).stroke();
        doc.path(
          `M ${x + s * 0.16} ${y + s * 0.88} C ${x + s * 0.16} ${y + s * 0.52} ` +
          `${x + s * 0.84} ${y + s * 0.52} ${x + s * 0.84} ${y + s * 0.88}`
        ).stroke();
        break;

      case 'news':
        doc.roundedRect(x + s * 0.08, y + s * 0.08, s * 0.84, s * 0.84, s * 0.08).stroke();
        doc.moveTo(x + s * 0.26, y + s * 0.32).lineTo(x + s * 0.74, y + s * 0.32)
          .moveTo(x + s * 0.26, y + s * 0.52).lineTo(x + s * 0.74, y + s * 0.52)
          .moveTo(x + s * 0.26, y + s * 0.72).lineTo(x + s * 0.54, y + s * 0.72)
          .stroke();
        break;

      case 'chat':
        doc.roundedRect(x + s * 0.06, y + s * 0.1, s * 0.88, s * 0.6, s * 0.16).stroke();
        doc.path(
          `M ${x + s * 0.3} ${y + s * 0.7} L ${x + s * 0.24} ${y + s * 0.92} ` +
          `L ${x + s * 0.5} ${y + s * 0.7}`
        ).stroke();
        break;

      case 'clock':
        doc.circle(cx, y + s * 0.5, s * 0.4).stroke();
        doc.moveTo(cx, y + s * 0.28).lineTo(cx, y + s * 0.52).lineTo(cx + s * 0.18, y + s * 0.62).stroke();
        break;

      case 'refresh':
        doc.path(
          `M ${x + s * 0.86} ${y + s * 0.5} A ${s * 0.36} ${s * 0.36} 0 1 1 ${cx} ${y + s * 0.14}`
        ).stroke();
        doc.path(
          `M ${cx - s * 0.02} ${y + s * 0.02} L ${cx + s * 0.16} ${y + s * 0.14} ` +
          `L ${cx - s * 0.02} ${y + s * 0.26} Z`
        ).fill();
        break;

      case 'arrow':
        doc.moveTo(x + s * 0.1, y + s * 0.5).lineTo(x + s * 0.82, y + s * 0.5).stroke();
        doc.path(
          `M ${x + s * 0.6} ${y + s * 0.26} L ${x + s * 0.88} ${y + s * 0.5} ` +
          `L ${x + s * 0.6} ${y + s * 0.74}`
        ).stroke();
        break;

      case 'diamond':
        doc.path(
          `M ${cx} ${y + s * 0.06} L ${x + s * 0.92} ${y + s * 0.5} L ${cx} ${y + s * 0.94} ` +
          `L ${x + s * 0.08} ${y + s * 0.5} Z`
        ).stroke();
        break;

      case 'question':
        doc.circle(cx, y + s * 0.5, s * 0.42).stroke();
        doc.font(F.bold).fontSize(s * 0.62)
          .text('?', x, y + s * 0.2, { width: s, align: 'center', lineBreak: false });
        break;

      case 'eye':
        doc.ellipse(cx, y + s * 0.5, s * 0.44, s * 0.28).stroke();
        doc.circle(cx, y + s * 0.5, s * 0.12).fill();
        break;

      case 'target':
        doc.circle(cx, y + s * 0.5, s * 0.4).stroke();
        doc.circle(cx, y + s * 0.5, s * 0.12).fill();
        break;

      case 'chart':
        doc.moveTo(x + s * 0.08, y + s * 0.08).lineTo(x + s * 0.08, y + s * 0.9)
          .lineTo(x + s * 0.92, y + s * 0.9).stroke();
        doc.path(
          `M ${x + s * 0.2} ${y + s * 0.68} L ${x + s * 0.45} ${y + s * 0.42} ` +
          `L ${x + s * 0.62} ${y + s * 0.56} L ${x + s * 0.86} ${y + s * 0.24}`
        ).stroke();
        break;

      case 'pin':
        doc.circle(cx, y + s * 0.34, s * 0.22).stroke();
        doc.path(
          `M ${cx - s * 0.17} ${y + s * 0.48} L ${cx} ${y + s * 0.92} L ${cx + s * 0.17} ${y + s * 0.48}`
        ).stroke();
        break;

      case 'building':
        doc.rect(x + s * 0.14, y + s * 0.1, s * 0.72, s * 0.8).stroke();
        doc.moveTo(x + s * 0.32, y + s * 0.3).lineTo(x + s * 0.48, y + s * 0.3)
          .moveTo(x + s * 0.58, y + s * 0.3).lineTo(x + s * 0.72, y + s * 0.3)
          .moveTo(x + s * 0.32, y + s * 0.5).lineTo(x + s * 0.48, y + s * 0.5)
          .moveTo(x + s * 0.58, y + s * 0.5).lineTo(x + s * 0.72, y + s * 0.5)
          .moveTo(x + s * 0.44, y + s * 0.72).lineTo(x + s * 0.56, y + s * 0.72)
          .moveTo(x + s * 0.44, y + s * 0.72).lineTo(x + s * 0.44, y + s * 0.9)
          .moveTo(x + s * 0.56, y + s * 0.72).lineTo(x + s * 0.56, y + s * 0.9)
          .stroke();
        break;

      case 'calendar':
        doc.roundedRect(x + s * 0.08, y + s * 0.14, s * 0.84, s * 0.76, s * 0.08).stroke();
        doc.moveTo(x + s * 0.08, y + s * 0.36).lineTo(x + s * 0.92, y + s * 0.36).stroke();
        doc.moveTo(x + s * 0.3, y + s * 0.04).lineTo(x + s * 0.3, y + s * 0.22)
          .moveTo(x + s * 0.7, y + s * 0.04).lineTo(x + s * 0.7, y + s * 0.22)
          .stroke();
        break;

      case 'globe':
        doc.circle(cx, y + s * 0.5, s * 0.4).stroke();
        doc.moveTo(x + s * 0.1, y + s * 0.5).lineTo(x + s * 0.9, y + s * 0.5).stroke();
        doc.ellipse(cx, y + s * 0.5, s * 0.17, s * 0.4).stroke();
        break;

      case 'dot':
        doc.circle(cx, y + s * 0.5, s * 0.22).fill();
        break;

      default:
        doc.circle(cx, y + s * 0.5, s * 0.34).stroke();
    }

    doc.restore();
  }

  // Small filled square with initials, standing in for the branded link tiles
  linkTile(doc, initials, x, y, s, color) {
    doc.save();
    doc.roundedRect(x, y, s, s, s * 0.22).fill(color);
    doc.font(F.bold).fontSize(s * 0.5).fillColor(C.white)
      .text(initials, x, y + s * 0.24, { width: s, align: 'center', lineBreak: false });
    doc.restore();
  }

  linkIcon(doc, link, x, y, s) {
    const host = this.hostname(link.url);
    if (host.includes('linkedin')) return this.linkTile(doc, 'in', x, y, s, '#0a66c2');
    if (host.includes('crunchbase')) return this.linkTile(doc, 'cb', x, y, s, '#146aff');
    if (host.includes('finance.yahoo') || host.includes('ticker')) {
      return this.drawIcon(doc, 'chart', x, y, s, C.blue);
    }
    return this.drawIcon(doc, 'globe', x, y, s, C.blue);
  }

  // =========================================================================
  // Typography
  // =========================================================================

  /**
   * Section title, sentence case like the deck, with an optional outline icon.
   * `follows` is the measured height of the first block underneath, so the
   * title never strands at the foot of a page.
   */
  h1(doc, ctx, text, { icon, follows = 0 } = {}) {
    if (!this.atTop(doc)) this.space(doc, 26);

    doc.font(F.bold).fontSize(16);
    const headingHeight = doc.heightOfString(text, { width: CONTENT_WIDTH - (icon ? 24 : 0) });

    const line = this.lineHeight(doc, BODY_SIZE);
    const keep = Math.min(Math.max(follows, line * 3), PAGE_CAP * 0.5);
    this.ensure(doc, ctx, headingHeight + 12 + keep);

    ctx.toc.push({ level: 1, label: text, page: this.pageNumber(doc) });

    const top = doc.y;
    if (icon) this.drawIcon(doc, icon, MARGIN, top + 2, 13, C.blue);

    doc.font(F.bold).fontSize(16).fillColor(C.ink)
      .text(text, MARGIN + (icon ? 24 : 0), top, { width: CONTENT_WIDTH - (icon ? 24 : 0) });

    this.space(doc, 12);
  }

  /**
   * Subsection label. With an icon it reads dark like "Why Change" in the
   * deck; without one it is the blue bold line "Company Goals" uses.
   */
  h3(doc, ctx, text, { icon, color = C.blue, follows = 0 } = {}) {
    if (!this.atTop(doc)) this.space(doc, 14);

    const keep = Math.min(
      Math.max(follows, this.lineHeight(doc, BODY_SIZE) * 2),
      PAGE_CAP * 0.5,
    );
    this.ensure(doc, ctx, 16 + keep);

    const top = doc.y;
    if (icon) {
      this.drawIcon(doc, icon, MARGIN, top, 10.5, C.blue);
      doc.font(F.bold).fontSize(10.5).fillColor(C.ink)
        .text(text, MARGIN + 19, top, { width: CONTENT_WIDTH - 19 });
    } else {
      doc.font(F.bold).fontSize(10.5).fillColor(color)
        .text(text, MARGIN, top, { width: CONTENT_WIDTH });
    }

    this.space(doc, 7);
  }

  /**
   * One evidence-backed claim: outline icon, full-width copy, citation chips.
   * A claim never breaks across the fold - it moves whole instead.
   */
  bullet(doc, ctx, item, { icon = 'dot', color = C.blue, indent = 26, size = BODY_SIZE } = {}) {
    const text = typeof item === 'string' ? item : item?.text;
    if (!text) return;

    const citations = (typeof item === 'object' && Array.isArray(item.citations)) ? item.citations : [];
    const options = { size, indent, citations };

    this.fitBlock(doc, ctx, this.flowHeight(doc, text, options));

    const top = doc.y;
    if (icon === 'dot') {
      doc.save().circle(MARGIN + 5, top + size * 0.56, 2.2).fill(color).restore();
    } else {
      this.drawIcon(doc, icon, MARGIN + 1, top + 0.5, 10.5, color);
    }

    this.writeText(doc, text, options);
    this.space(doc, 11);
  }

  bulletHeight(doc, item, { indent = 26, size = BODY_SIZE } = {}) {
    const text = typeof item === 'string' ? item : item?.text;
    if (!text) return 0;

    const citations = (typeof item === 'object' && Array.isArray(item.citations)) ? item.citations : [];
    return this.flowHeight(doc, text, { size, indent, citations });
  }

  // Height of the first block of a list - what its heading keeps beside it
  listOpener(doc, items, options) {
    const first = (items || []).filter(Boolean)[0];
    return first ? this.bulletHeight(doc, first, options) : 0;
  }

  subsectionsOpener(doc, groups) {
    const first = (groups || []).find(([, items]) => (items || []).filter(Boolean).length);
    return first ? 22 + this.listOpener(doc, first[1]) : 0;
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
    this.ensure(doc, ctx, 20);
    this.writeText(doc, 'No supporting evidence was found for this section.', {
      font: F.italic,
      size: 9,
      color: C.muted,
      indent: 26,
    });
    this.space(doc, 11);
  }

  paragraph(doc, ctx, text, options = {}) {
    if (!text) return;
    this.fitBlock(doc, ctx, this.flowHeight(doc, text, options));
    this.writeText(doc, text, options);
    this.space(doc, 10);
  }

  // =========================================================================
  // Formatting helpers
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

  truncate(text, max) {
    const clean = String(text).replace(/\s+/g, ' ').trim();
    return clean.length > max ? `${clean.slice(0, max).trim()}…` : clean;
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

  // "May 2026" - how every extracted record states when it happened
  monthYear(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
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

  scoreColor(value) {
    if (value >= 80) return C.green;
    if (value >= 60) return C.blue;
    if (value >= 40) return C.amber;
    return C.muted;
  }

  // =========================================================================
  // Cover - laid out like the deck: title and url top left, score badge top
  // right, then Fast Facts on the left and Quick Links / details on the right,
  // with icons in place of labels and no rules or boxes.
  // =========================================================================

  coverPage(doc, ctx, report, meta) {
    ctx.group = '';
    this.newPage(doc, ctx);
    this.withoutMargins(doc, () => this.drawCover(doc, report, meta));
  }

  drawCover(doc, report, meta) {
    const facts = report.fastFacts || {};
    const score = report.score || {};

    const badgeSize = 100;
    const titleWidth = CONTENT_WIDTH - badgeSize - 36;

    // --- Title ---
    doc.font(F.bold).fontSize(30).fillColor(C.ink)
      .text(report.companyName, MARGIN, 48, { width: titleWidth });

    doc.font(F.regular).fontSize(11).fillColor(C.muted)
      .text(this.hostname(facts.website) || facts.industry || '', MARGIN, doc.y + 4, { width: titleWidth });

    if (score.value) this.scoreBadge(doc, score, PAGE.width - MARGIN - badgeSize, 46, badgeSize);

    // --- Two columns ---
    const leftWidth = CONTENT_WIDTH * 0.5;
    const rightX = MARGIN + CONTENT_WIDTH * 0.56;
    const rightWidth = CONTENT_WIDTH * 0.44;
    const top = 138;

    this.coverFacts(doc, MARGIN, top, leftWidth, report, facts, score);
    this.coverLinks(doc, rightX, top, rightWidth, report, facts, meta);
  }

  coverHeading(doc, text, x, y, width) {
    doc.font(F.bold).fontSize(13.5).fillColor(C.ink).text(text, x, y, { width });
    return doc.y + 10;
  }

  coverFits(y, height) {
    return y + height <= BODY_BOTTOM - 4;
  }

  coverFacts(doc, x, y, width, report, facts, score) {
    let cursor = this.coverHeading(doc, 'Fast Facts', x, y, width);

    if (facts.description) {
      doc.font(F.regular).fontSize(9.5).fillColor(C.body)
        .text(this.truncate(facts.description, 380), x, cursor, { width, lineGap: 3 });
      cursor = doc.y + 13;
    }

    const revenue = this.money(facts.revenue, facts.revenueCurrency);
    const rows = [
      ['pin', facts.headquarters ? `Headquartered in ${facts.headquarters}` : null],
      ['building', facts.industry],
      ['chart', revenue ? `${revenue} revenue${facts.revenueAsOf ? ` (FY${facts.revenueAsOf})` : ''}` : null],
      // Headcount sits with the links, where the deck and the web report both
      // put it - not here
      ['chart', this.money(facts.marketCap) ? `${this.money(facts.marketCap)} market cap` : null],
      ['calendar', facts.founded ? `Founded ${facts.founded}` : null],
    ].filter(([, value]) => value);

    for (const [icon, value] of rows) {
      doc.font(F.regular).fontSize(9.5);
      const height = doc.heightOfString(value, { width: width - 20, lineGap: 2 });
      if (!this.coverFits(cursor, height)) return;

      this.drawIcon(doc, icon, x, cursor - 0.5, 10.5, C.blue);
      doc.fillColor(C.ink).text(value, x + 20, cursor, { width: width - 20, lineGap: 2 });
      cursor = doc.y + 8;
    }

    // Score narrative reads as a plain paragraph, the way the deck writes it
    const line = score.summary
      || (score.value ? `${report.companyName} has a Salesmotion score of ${score.value}.` : null);

    if (line && this.coverFits(cursor + 8, 30)) {
      doc.font(F.regular).fontSize(9.5).fillColor(C.body)
        .text(line, x, cursor + 8, { width, lineGap: 3 });
    }
  }

  coverLinks(doc, x, y, width, report, facts, meta) {
    let cursor = this.coverHeading(doc, 'Quick Links', x, y, width);

    // Reports written before the homepage was fetched hold it only in
    // fastFacts, so it is merged in rather than missing from the cover
    const links = [...(report.quickLinks || [])];
    if (facts.website && !links.some(l => this.hostname(l.url) === this.hostname(facts.website))) {
      links.unshift({ label: this.hostname(facts.website), url: facts.website });
    }

    // Headcount is not a link, but the deck lists it here and so does the web
    // report, so the two covers stay the same shape
    if (facts.employees) {
      const headcount = `${Number(facts.employees).toLocaleString()} employees`;
      doc.font(F.regular).fontSize(9.5);
      if (this.coverFits(cursor, doc.heightOfString(headcount, { width: width - 20, lineGap: 2 }))) {
        this.drawIcon(doc, 'person', x, cursor - 0.5, 10.5, C.blue);
        doc.font(F.regular).fontSize(9.5).fillColor(C.ink)
          .text(headcount, x + 20, cursor, { width: width - 20, lineGap: 2 });
        cursor = doc.y + 8;
      }
    }

    for (const link of links.slice(0, 7)) {
      doc.font(F.regular).fontSize(9.5);
      const height = doc.heightOfString(link.label, { width: width - 20, lineGap: 2 });
      if (!this.coverFits(cursor, height)) break;

      this.linkIcon(doc, link, x, cursor - 0.5, 10.5);
      // linkIcon may set a tiny font to draw tile initials - font is not part
      // of pdfkit's saved graphics state, so it has to be set back explicitly
      doc.font(F.regular).fontSize(9.5).fillColor(C.blue).text(link.label, x + 20, cursor, {
        width: width - 20,
        lineGap: 2,
        link: link.url,
      });
      cursor = doc.y + 8;
    }

    // --- Account information ---
    const context = report.context || {};
    const rows = [
      ['calendar', report.accountAddedAt || meta.company?.addedAt
        ? `Added ${this.day(report.accountAddedAt || meta.company?.addedAt)}` : null],
      ['person', (context.sellerName || meta.seller?.name)
        ? `Prepared for ${context.sellerName || meta.seller?.name}` : null],
      ['clock', this.moment(report.lastUpdatedAt || report.generatedAt)
        ? `Last refreshed ${this.moment(report.lastUpdatedAt || report.generatedAt)}` : null],
    ].filter(([, value]) => value);

    if (!rows.length || !this.coverFits(cursor + 18, 40)) return;

    cursor = this.coverHeading(doc, 'Account Information', x, cursor + 18, width);

    for (const [icon, value] of rows) {
      doc.font(F.regular).fontSize(9.5);
      const height = doc.heightOfString(value, { width: width - 20, lineGap: 2 });
      if (!this.coverFits(cursor, height)) return;

      this.drawIcon(doc, icon, x, cursor - 0.5, 10.5, C.blue);
      doc.fillColor(C.ink).text(value, x + 20, cursor, { width: width - 20, lineGap: 2 });
      cursor = doc.y + 8;
    }
  }

  scoreBadge(doc, score, x, y, size) {
    const colour = this.scoreColor(score.value);

    doc.save();
    doc.roundedRect(x, y, size, size, 14).fill(C.white);
    doc.roundedRect(x, y, size, size, 14).lineWidth(1).strokeColor(C.line).stroke();

    doc.font(F.bold).fontSize(34).fillColor(colour)
      .text(String(score.value), x, y + 19, { width: size, align: 'center' });
    doc.font(F.bold).fontSize(8).fillColor(C.ink)
      .text((score.band || '').toUpperCase(), x, y + 58, { width: size, align: 'center', characterSpacing: 0.8 });
    doc.font(F.regular).fontSize(6.8).fillColor(C.muted)
      .text('SALESMOTION SCORE', x, y + 78, { width: size, align: 'center', characterSpacing: 0.4 });
    doc.restore();
  }

  // =========================================================================
  // Contents - claimed up front, filled in once every section knows its page
  // =========================================================================

  contentsPlaceholder(doc, ctx) {
    ctx.group = 'Contents';
    this.newPage(doc, ctx);
    ctx.tocPageIndex = doc.bufferedPageRange().count - 1;
  }

  drawContents(doc, ctx) {
    if (ctx.tocPageIndex === null) return;

    doc.switchToPage(ctx.tocPageIndex);

    this.withoutMargins(doc, () => {
      doc.font(F.bold).fontSize(16).fillColor(C.ink)
        .text('Contents', MARGIN, BODY_TOP, { width: CONTENT_WIDTH });

      const top = doc.y + 16;
      const colWidth = (CONTENT_WIDTH - 60) / 2;
      let col = 0;
      let cursor = top;

      const x = () => MARGIN + col * (colWidth + 60);

      ctx.toc.forEach(entry => {
        const height = entry.level === 0 ? 30 : 18;
        if (cursor + height > BODY_BOTTOM) {
          if (col >= 1) return; // more sections than the page can list
          col += 1;
          cursor = top;
        }

        const isGroup = entry.level === 0;
        if (isGroup && cursor > top) cursor += 10;

        const indent = isGroup ? 0 : 16;
        const numberWidth = 28;

        doc.font(isGroup ? F.bold : F.regular)
          .fontSize(isGroup ? 10.5 : 9.5)
          .fillColor(isGroup ? C.ink : C.body)
          .text(entry.label, x() + indent, cursor, {
            width: colWidth - indent - numberWidth - 6,
            lineBreak: false,
          });

        doc.font(isGroup ? F.bold : F.regular).fontSize(isGroup ? 10.5 : 9.5)
          .fillColor(isGroup ? C.blue : C.muted)
          .text(String(entry.page), x() + colWidth - numberWidth, cursor, {
            width: numberWidth,
            align: 'right',
            lineBreak: false,
          });

        cursor += isGroup ? 21 : 18;
      });
    });
  }

  // =========================================================================
  // Group 1 — What You Need To Know
  // =========================================================================

  executiveBriefPages(doc, ctx, report) {
    const brief = report.executiveBrief || {};
    const evidence = report.evidence || {};

    // Coverage first, before anything it qualifies. A reader who has already
    // absorbed six insights before being told the report was written on nine
    // sources has been misled by the ordering alone.
    this.coverageWarning(doc, ctx, report.coverage);

    this.h1(doc, ctx, 'Key Insights', { follows: this.listOpener(doc, brief.keyInsights) });

    // Pinned above the written insights: the verified records, in trigger
    // order. Programmes and regulatory actions share the top tier - both are
    // dated commitments the account has made, and both are things a rep can
    // open a call with. The model's insights follow underneath.
    this.programBlock(doc, ctx, evidence.strategicPrograms);
    this.regulatoryBlock(doc, ctx, evidence.regulatoryActions);
    this.contractBlock(doc, ctx, evidence.contractAwards, { compact: true });
    this.resultsBlock(doc, ctx, evidence.latestResults);
    this.hiringBlock(doc, ctx, evidence.hiring);

    this.bulletList(doc, ctx, brief.keyInsights, { icon: 'bulb', color: C.amber });

    this.h1(doc, ctx, 'Opportunities', { follows: this.listOpener(doc, brief.opportunities) });
    this.bulletList(doc, ctx, brief.opportunities, { icon: 'case', color: C.green });

    this.h1(doc, ctx, 'Challenges', { follows: this.listOpener(doc, brief.challenges) });
    this.bulletList(doc, ctx, brief.challenges, { icon: 'case', color: C.red });

    // Verified moves first, newest first, then what the model reads into them.
    // A section that carries both never says "no specific executives
    // mentioned" - either it lists the people or it says plainly there were none.
    this.h1(doc, ctx, 'People Updates', {
      follows: this.listOpener(doc, brief.peopleUpdates),
    });
    this.peopleBlock(doc, ctx, evidence.executiveMoves);
    if (brief.peopleUpdates?.length) {
      this.bulletList(doc, ctx, brief.peopleUpdates, { icon: 'person', color: C.blue });
    }

    const news = (brief.topNews || []).filter(n => n?.title);
    this.h1(doc, ctx, 'Top News', { follows: this.newsItemHeight(doc, news[0]) });
    this.newsList(doc, ctx, brief.topNews);

    const points = (brief.talkingPoints || []).filter(Boolean);
    this.h1(doc, ctx, 'Talking Points', {
      follows: points[0] ? this.talkingPointHeight(doc, points[0]) : 0,
    });
    this.talkingPointList(doc, ctx, brief.talkingPoints);

    if (brief.executivePerspective?.length) {
      this.h1(doc, ctx, 'Executive Perspective', {
        follows: this.quoteCardHeight(doc, brief.executivePerspective[0]),
      });
      brief.executivePerspective.forEach(q => this.quoteCard(doc, ctx, q));
    }
  }

  // =========================================================================
  // Verified record blocks
  //
  // Everything drawn here came out of a filing, a job board, a public register
  // or a dated article, and was extracted in code. None of it passed through
  // the model, which is why these lines can carry a figure and a name.
  //
  // Each block renders nothing at all when it holds no records. An absent block
  // is the honest answer; a block saying "none found" on every account would be
  // five lines of nothing on most reports.
  // =========================================================================

  /**
   * One record: a bold lead line, a muted detail line under it, citations on
   * the end. The pair never splits across a page.
   */
  recordLine(doc, ctx, { icon, color, lead, detail, citations = [], link }) {
    if (!lead) return;

    const indent = 26;
    const leadOptions = { font: F.bold, size: 9.6, color: C.ink, indent, lineGap: 2, link };
    const detailOptions = {
      size: 8.8, color: C.body, indent, lineGap: 2.4,
      citations: Array.isArray(citations) ? citations.slice(0, 3) : [],
    };

    this.fitBlock(doc, ctx,
      this.flowHeight(doc, lead, leadOptions)
      + (detail ? 3 + this.flowHeight(doc, detail, detailOptions) : 0));

    this.drawIcon(doc, icon, MARGIN + 1, doc.y + 0.5, 10.5, color);
    this.writeText(doc, lead, leadOptions);

    if (detail) {
      this.space(doc, 3);
      this.writeText(doc, detail, detailOptions);
    }

    this.space(doc, 9);
  }

  /** A small label above a run of records, so the block reads as one thing. */
  blockLabel(doc, ctx, text, color = C.blue) {
    this.ensure(doc, ctx, 22);
    doc.font(F.bold).fontSize(7.4).fillColor(color)
      .text(text.toUpperCase(), MARGIN, doc.y, {
        width: CONTENT_WIDTH,
        characterSpacing: 0.9,
      });
    this.space(doc, 5);
  }

  /**
   * Said on the face of the report rather than left for the reader to work out.
   *
   * A report written on nine sources and one written on forty format
   * identically, and the thin one reads exactly as confident as the thorough
   * one. This is the only thing that separates them.
   */
  coverageWarning(doc, ctx, coverage) {
    if (!coverage?.thin || !coverage.warning) return;

    const padding = 12;
    const inner = CONTENT_WIDTH - padding * 2;

    doc.font(F.regular).fontSize(8.8);
    const height = doc.heightOfString(coverage.warning, { width: inner - 16, lineGap: 2.4 })
      + padding * 2;

    this.fitBlock(doc, ctx, height);

    const top = doc.y;
    doc.save();
    doc.roundedRect(MARGIN, top, CONTENT_WIDTH, height, 6).fill('#fdf6e7');
    doc.restore();

    this.drawIcon(doc, 'question', MARGIN + padding, top + padding - 1, 11, C.amber);
    doc.font(F.regular).fontSize(8.8).fillColor(C.ink)
      .text(coverage.warning, MARGIN + padding + 16, top + padding, { width: inner - 16, lineGap: 2.4 });

    doc.y = top + height;
    this.space(doc, 14);
  }

  /** Named programmes - the strongest trigger, so it sits above everything. */
  programBlock(doc, ctx, programs = []) {
    const list = (programs || []).filter(p => p?.name);
    if (!list.length) return;

    this.blockLabel(doc, ctx, 'Named programmes', C.purple);

    list.slice(0, 4).forEach(program => {
      const when = this.monthYear(program.announcedAt);
      this.recordLine(doc, ctx, {
        icon: 'target',
        color: C.purple,
        lead: [program.name, program.headlineNumber].filter(Boolean).join(' — '),
        detail: [when ? `Announced ${when}` : null, program.summary].filter(Boolean).join('. '),
        citations: program.citations,
        link: program.url,
      });
    });
  }

  /** Regulatory action: same tier as a programme, because the deadline is real. */
  regulatoryBlock(doc, ctx, actions = []) {
    const list = (actions || []).filter(a => a?.regulator);
    if (!list.length) return;

    this.blockLabel(doc, ctx, 'Regulatory triggers', C.red);

    list.slice(0, 4).forEach(action => {
      const when = this.monthYear(action.announcedAt);
      const label = REGULATORY_LABELS[action.actionType] || action.actionType;

      this.recordLine(doc, ctx, {
        icon: 'case',
        color: C.red,
        lead: [`${action.regulator} — ${label}`, action.amount].filter(Boolean).join(' · '),
        detail: [when, action.detail].filter(Boolean).join(' · '),
        citations: action.citations,
        link: action.url,
      });
    });
  }

  /** Filed results. Every figure came off a filing; absent ones stay absent. */
  resultsBlock(doc, ctx, results) {
    if (!results) return;

    const parts = [
      results.revenue ? `${this.money(results.revenue, results.currency)} revenue` : null,
      results.profit ? `${this.money(results.profit, results.currency)} profit` : null,
      Number.isFinite(results.eps) ? `EPS ${Number(results.eps).toFixed(2)}` : null,
      results.buybackAmount
        ? `${this.money(results.buybackAmount, results.currency)} buybacks`
        : (results.buyback || null),
      Number.isFinite(results.dividendPerShare)
        ? `dividend ${Number(results.dividendPerShare).toFixed(2)}/share`
        : null,
    ].filter(Boolean);

    if (!parts.length) return;

    this.blockLabel(doc, ctx, 'Latest results', C.teal);

    const reported = results.lastEarningsAt
      ? `Reported ${this.day(results.lastEarningsAt)}`
      : (results.periodEndedAt ? `Period ended ${this.day(results.periodEndedAt)}` : null);

    this.recordLine(doc, ctx, {
      icon: 'chart',
      color: C.teal,
      lead: `${results.period || 'Latest period'}: ${parts.join(', ')}`,
      detail: [reported, results.source].filter(Boolean).join('  ·  '),
      citations: results.citations,
      link: results.url,
    });
  }

  /** The counted hiring line. Nothing counted, nothing shown. */
  hiringBlock(doc, ctx, hiring) {
    if (!hiring?.summary) return;

    this.blockLabel(doc, ctx, 'Hiring signal', C.green);

    const breakdown = (hiring.byFunction || [])
      .slice(0, 4)
      .map(f => `${f.name} ${f.count}`)
      .join('  ·  ');

    this.recordLine(doc, ctx, {
      icon: 'person',
      color: C.green,
      lead: hiring.summary,
      detail: [breakdown, hiring.source].filter(Boolean).join('  —  '),
      citations: hiring.citations,
    });
  }

  /**
   * Executive moves, newest first.
   *
   * The one block that speaks when it is empty. "No specific executives
   * mentioned" reads as a broken product; the replacement states the window
   * that was searched and leaves it there.
   */
  peopleBlock(doc, ctx, moves = []) {
    const list = (moves || []).filter(m => m?.person);

    if (!list.length) {
      this.ensure(doc, ctx, 22);
      this.writeText(doc, 'No verified executive moves in the last 90 days.', {
        size: 9.2,
        color: C.body,
        indent: 26,
      });
      this.space(doc, 11);
      return;
    }

    list.slice(0, 6).forEach(move => {
      this.recordLine(doc, ctx, {
        icon: 'person',
        color: C.blue,
        lead: executiveMoves.format(move),
        detail: move.source || '',
        citations: move.citations,
        link: move.url,
      });
    });
  }

  /** Federal awards. `compact` is the Key Insights form; full is Whitespace. */
  contractBlock(doc, ctx, awards = [], { compact = false } = {}) {
    const list = (awards || []).filter(a => a?.agency || a?.awardId);
    if (!list.length) return;

    this.blockLabel(doc, ctx, 'Federal contract awards', C.brand);

    list.slice(0, compact ? 2 : 6).forEach(award => {
      this.recordLine(doc, ctx, {
        icon: 'building',
        color: C.brand,
        lead: contractFetcher.format(award),
        detail: compact
          ? (award.awardId ? `Award ${award.awardId}` : '')
          : [award.awardId ? `Award ${award.awardId}` : null, award.description]
              .filter(Boolean).join(' — '),
        citations: award.citations,
        link: award.url,
      });
    });
  }

  /** Patent filings and grants - direction, not a trigger. */
  patentBlock(doc, ctx, patents = []) {
    const list = (patents || []).filter(p => p?.title);
    if (!list.length) return;

    this.blockLabel(doc, ctx, 'Patent activity', C.teal);

    list.slice(0, 6).forEach(patent => {
      this.recordLine(doc, ctx, {
        icon: 'bulb',
        color: C.teal,
        lead: patent.title,
        detail: [patentFetcher.format(patent), patent.applicant].filter(Boolean).join('  ·  '),
        citations: patent.citations,
        link: patent.url,
      });
    });
  }

  newsParts(item) {
    const indent = 26;

    return {
      indent,
      summary: item.summary ? this.truncate(item.summary, 340) : '',
      meta: [item.source, item.publishedAt ? this.formatDate(item.publishedAt) : null]
        .filter(Boolean).join('  ·  '),
      titleOptions: {
        font: F.bold,
        size: 9.8,
        color: C.ink,
        indent,
        lineGap: 2.2,
        link: item.url || undefined,
      },
      summaryOptions: {
        size: 9.2,
        indent,
        lineGap: 2.6,
        citations: Array.isArray(item.citations) ? item.citations : [],
      },
      metaOptions: { size: 7.8, color: C.muted, indent },
    };
  }

  newsItemHeight(doc, item) {
    if (!item?.title) return 0;
    const { summary, meta, titleOptions, summaryOptions, metaOptions } = this.newsParts(item);

    return this.flowHeight(doc, item.title, titleOptions)
      + (summary ? 3 + this.flowHeight(doc, summary, summaryOptions) : 0)
      + (meta ? 3 + this.flowHeight(doc, meta, metaOptions) : 0);
  }

  newsList(doc, ctx, news) {
    const list = (news || []).filter(n => n?.title);

    if (!list.length) {
      this.emptyNote(doc, ctx);
      return;
    }

    list.forEach(item => {
      const { summary, meta, titleOptions, summaryOptions, metaOptions } = this.newsParts(item);

      // Headline, summary and byline are one story - they move together
      this.fitBlock(doc, ctx, this.newsItemHeight(doc, item));

      this.drawIcon(doc, 'news', MARGIN + 1, doc.y + 0.5, 10.5, C.blue);
      this.writeText(doc, item.title, titleOptions);

      if (summary) {
        this.space(doc, 3);
        this.writeText(doc, summary, summaryOptions);
      }

      if (meta) {
        this.space(doc, 3);
        this.writeText(doc, meta, metaOptions);
      }

      this.space(doc, 13);
    });
  }

  quoteCardHeight(doc, quote) {
    if (!quote?.quote) return 0;

    const attribution = [quote.person, quote.title].filter(Boolean).join(', ');
    doc.font(F.italic).fontSize(10.2);

    return doc.heightOfString(`"${String(quote.quote).trim()}"`, {
      width: CONTENT_WIDTH - 36,
      lineGap: 3,
    }) + 30 + (attribution ? 18 : 0);
  }

  /**
   * Full-width tinted card, italic quote, muted attribution - no accent bar,
   * matching the deck. A quote taller than a page falls back to plain text.
   */
  quoteCard(doc, ctx, quote) {
    if (!quote?.quote) return;

    const padding = 15;
    const inner = CONTENT_WIDTH - padding * 2 - 6;
    const body = `"${String(quote.quote).trim()}"`;
    const attributionParts = [quote.person, quote.title].filter(Boolean).join(', ');
    // Where and when, both off the cited source rather than the model - a quote
    // with no date cannot be checked, which is why one is required upstream
    const context = [quote.source, this.day(quote.publishedAt)].filter(Boolean).join(', ');
    const attribution = attributionParts
      ? `– ${attributionParts}${context ? ` — ${context}` : ''}`
      : '';
    const citations = Array.isArray(quote.citations) ? quote.citations : [];

    const height = this.quoteCardHeight(doc, quote);

    if (height > PAGE_CAP) {
      // No card can hold it; the words still land on the page
      this.paragraph(doc, ctx, body, { font: F.italic, size: 10.2, color: C.ink, lineGap: 3 });
      if (attribution) {
        this.paragraph(doc, ctx, attribution, { size: 8.6, color: C.muted, citations });
      }
      return;
    }

    this.fitBlock(doc, ctx, height);

    const top = doc.y;
    doc.save();
    doc.roundedRect(MARGIN, top, CONTENT_WIDTH, height, 8).fill(C.card);
    doc.restore();

    doc.font(F.italic).fontSize(10.2).fillColor(C.ink)
      .text(body, MARGIN + padding, top + padding, { width: inner, lineGap: 3 });

    if (attribution) {
      doc.font(F.regular).fontSize(8.6).fillColor(C.muted)
        .text(attribution, MARGIN + padding, top + height - padding - 8, {
          width: inner,
          lineBreak: false,
          continued: citations.length > 0,
        });
      if (citations.length) {
        doc.font(F.bold).fontSize(7.2).fillColor(C.blue)
          .text(`  ${citations.map(n => `[${n}]`).join('  ')}`, { lineBreak: false });
      }
    }

    doc.y = top + height;
    this.space(doc, 14);
  }

  /**
   * A talking point keeps its headline, spoken body and cues together, led by
   * the deck's chat icon.
   */
  talkingPointHeight(doc, item) {
    const point = typeof item === 'string' ? { text: item } : (item || {});
    const body = point.text || '';
    const indent = 26;

    const heading = point.headline || this.truncate(body, 90);
    let total = this.flowHeight(doc, heading, { font: F.bold, size: 9.8, indent, lineGap: 2.2 })
      + 4
      + this.flowHeight(doc, body, {
        indent,
        citations: Array.isArray(point.citations) ? point.citations : [],
      });

    for (const cue of [point.question, point.proof, point.objection]) {
      if (cue) total += 19 + this.flowHeight(doc, cue, { size: 9, indent: indent + 2, lineGap: 2.6 });
    }

    return total;
  }

  talkingPoint(doc, ctx, item, index) {
    const point = typeof item === 'string' ? { text: item } : (item || {});
    const body = point.text || '';
    if (!body && !point.headline) return;

    const citations = Array.isArray(point.citations) ? point.citations : [];
    const indent = 26;

    if (index > 0) this.space(doc, 5);

    this.fitBlock(doc, ctx, this.talkingPointHeight(doc, item), 4);

    this.drawIcon(doc, 'chat', MARGIN + 1, doc.y + 0.5, 10.5, C.blue);

    const heading = point.headline || this.truncate(body, 90);
    this.writeText(doc, heading, { font: F.bold, size: 9.8, color: C.ink, indent, lineGap: 2.2 });
    this.space(doc, 4);

    if (body) {
      this.writeText(doc, body, { indent, citations });
    }

    this.cueLine(doc, ctx, 'ASK', point.question, C.blue, indent);
    this.cueLine(doc, ctx, 'PROOF', point.proof, C.green, indent);
    this.cueLine(doc, ctx, 'IF THEY PUSH BACK', point.objection, C.amber, indent);

    this.space(doc, 13);
  }

  // Cue label above its body; the pair never separates
  cueLine(doc, ctx, label, text, color, baseIndent) {
    if (!text) return;

    const indent = baseIndent + 2;
    const options = { size: 9, indent, lineGap: 2.6 };

    this.space(doc, 7);
    this.fitBlock(doc, ctx, 12 + this.flowHeight(doc, text, options));

    doc.font(F.bold).fontSize(7.4).fillColor(color)
      .text(label, MARGIN + indent, doc.y, {
        width: CONTENT_WIDTH - indent,
        characterSpacing: 0.9,
      });

    this.space(doc, 2.5);
    this.writeText(doc, text, options);
  }

  talkingPointList(doc, ctx, items) {
    const list = (items || []).filter(Boolean);

    if (!list.length) {
      this.emptyNote(doc, ctx);
      return;
    }

    list.forEach((item, i) => this.talkingPoint(doc, ctx, item, i));
  }

  // =========================================================================
  // Group 2 — Research & Analysis
  // =========================================================================

  researchPages(doc, ctx, report) {
    const r = report.research || {};

    this.subsectionSection(doc, ctx, 'Insights', { icon: 'bulb' }, [
      ['Company Overview', r.companyOverview],
      ['Key People Changes', r.keyPeopleChanges],
      ['Key Projects', r.keyProjects],
      ['Aspirations', r.aspirations],
      ['Business Goals', r.businessGoals],
      ['Opportunities', r.opportunities],
      ['Macroeconomic Perspective', r.macroPerspective],
      ['Recent Press Announcements', r.recentPress],
    ]);

    this.subsectionSection(doc, ctx, 'Business Model', { icon: 'case' }, [
      ['Revenue Streams', r.businessModel?.revenueStreams],
      ['Go-to-Market Strategy', r.businessModel?.goToMarket],
      ['Ideal Customer Profile', r.businessModel?.idealCustomerProfile],
    ]);

    this.h1(doc, ctx, 'Strategic Initiatives', {
      icon: 'target',
      follows: this.listOpener(doc, r.strategicInitiatives),
    });
    this.bulletList(doc, ctx, r.strategicInitiatives);

    this.h1(doc, ctx, 'Financials', {
      icon: 'chart',
      follows: this.listOpener(doc, r.financials),
    });
    this.bulletList(doc, ctx, r.financials);

    this.subsectionSection(doc, ctx, 'SWOT Analysis', {}, [
      ['Strengths', r.swot?.strengths, C.green],
      ['Weaknesses', r.swot?.weaknesses, C.red],
      ['Opportunities', r.swot?.opportunities, C.blue],
      ['Threats', r.swot?.threats, C.amber],
    ]);

    this.whitespacePages(doc, ctx, report);
  }

  /**
   * Whitespace Identification.
   *
   * Patents and federal awards are dated public record, filed months before the
   * programme they belong to is announced. That makes them the wrong thing to
   * open a call with and the right thing to shape a roadmap around - so they
   * sit in Research rather than among the triggers in Key Insights, and the
   * narrative is written about direction rather than about timing.
   *
   * The section itself always renders; the patent and contract blocks inside it
   * appear only when there is something in them.
   */
  whitespacePages(doc, ctx, report) {
    const whitespace = report.whitespace || {};
    const evidence = report.evidence || {};

    const patents = (evidence.patents || []).filter(p => p?.title);
    const awards = (evidence.contractAwards || []).filter(a => a?.agency || a?.awardId);
    const insights = (whitespace.insights || []).filter(Boolean);
    const gaps = (whitespace.capabilityGaps || []).filter(Boolean);

    this.h1(doc, ctx, 'Whitespace Identification', {
      icon: 'eye',
      follows: patents.length || awards.length ? 40 : this.listOpener(doc, insights),
    });

    this.paragraph(doc, ctx,
      'R&D and public-sector activity on the public record — patent filings and federal contract awards. ' +
      'These run ahead of anything the company has announced, so they read as direction rather than as a trigger.',
      { size: 9, color: C.muted });

    this.patentBlock(doc, ctx, patents);
    this.contractBlock(doc, ctx, awards);

    if (insights.length) {
      this.h3(doc, ctx, 'What this points to', { follows: this.listOpener(doc, insights) });
      this.bulletList(doc, ctx, insights, { icon: 'dot', color: C.teal });
    }

    if (gaps.length) {
      this.h3(doc, ctx, 'Capability gaps it opens', { follows: this.listOpener(doc, gaps) });
      this.bulletList(doc, ctx, gaps, { icon: 'dot', color: C.green });
    }

    // Nothing found anywhere: say what was searched rather than leaving a
    // heading with a blank page under it
    if (!patents.length && !awards.length && !insights.length && !gaps.length) {
      this.writeText(doc,
        'No patent filings or US federal contract awards are on record for this account. ' +
        'Patent and contract crawls run only for accounts tagged as R&D-heavy or government-facing.',
        { font: F.italic, size: 9, color: C.muted, indent: 26 });
      this.space(doc, 11);
    }
  }

  // A section of labelled subsections; the title keeps the first claim with it
  subsectionSection(doc, ctx, title, headingOptions, groups) {
    this.h1(doc, ctx, title, { ...headingOptions, follows: this.subsectionsOpener(doc, groups) });
    groups.forEach(([label, items, color]) => this.subsection(doc, ctx, label, items, color));
  }

  subsection(doc, ctx, title, items, color = C.blue) {
    this.h3(doc, ctx, title, { color, follows: this.listOpener(doc, items) });
    this.bulletList(doc, ctx, items, { icon: 'dot', color });
  }

  // =========================================================================
  // Group 3 — Value
  // =========================================================================

  valuePages(doc, ctx, report) {
    const v = report.value || {};

    // Three Whys reads like the deck: dark subheads with their own icons
    this.h1(doc, ctx, 'Three Whys', {
      follows: 20 + this.listOpener(doc, v.whyChange),
    });
    this.whySubsection(doc, ctx, 'Why Change', 'refresh', v.whyChange);
    this.whySubsection(doc, ctx, 'Why Now', 'clock', v.whyNow);
    this.whySubsection(doc, ctx, 'Why You', 'arrow', v.whyYou);

    this.subsectionSection(doc, ctx, 'Value Pyramid', { icon: 'diamond' }, [
      ['Company Goals', v.valuePyramid?.companyGoals],
      ['Business Strategy', v.valuePyramid?.businessStrategy],
      ['Challenges and Obstacles', v.valuePyramid?.challengesObstacles],
      ['Value Paths', v.valuePyramid?.valuePaths],
    ]);

    if (v.valuePropositions?.length) {
      const propParts = (prop, idx) => ({
        title: `${idx + 1}. ${prop.title}`,
        titleOptions: { font: F.bold, size: 10, color: C.ink, indent: 26, lineGap: 2.2 },
        bodyOptions: {
          indent: 26,
          citations: Array.isArray(prop.citations) ? prop.citations : [],
        },
      });

      const propHeight = (prop, idx) => {
        const { title, titleOptions, bodyOptions } = propParts(prop, idx);
        return this.flowHeight(doc, title, titleOptions) + 4
          + this.flowHeight(doc, prop.body, bodyOptions);
      };

      this.h1(doc, ctx, 'Value Proposition Ideas', {
        icon: 'bulb',
        follows: propHeight(v.valuePropositions[0], 0),
      });

      v.valuePropositions.forEach((prop, idx) => {
        const { title, titleOptions, bodyOptions } = propParts(prop, idx);

        this.fitBlock(doc, ctx, propHeight(prop, idx));

        doc.save().circle(MARGIN + 5, doc.y + 5.5, 2.2).fill(C.blue).restore();
        this.writeText(doc, title, titleOptions);
        this.space(doc, 4);

        this.writeText(doc, prop.body, bodyOptions);
        this.space(doc, 12);
      });
    }

    this.h1(doc, ctx, 'Value Hypothesis', {
      icon: 'question',
      follows: this.listOpener(doc, v.hypotheses),
    });
    this.bulletList(doc, ctx, v.hypotheses);

    this.h1(doc, ctx, 'Point of View', {
      icon: 'eye',
      follows: this.listOpener(doc, v.pointOfView),
    });
    this.bulletList(doc, ctx, v.pointOfView);
  }

  whySubsection(doc, ctx, title, icon, items) {
    this.h3(doc, ctx, title, { icon, follows: this.listOpener(doc, items) });
    this.bulletList(doc, ctx, items, { icon: 'dot', color: C.blue });
  }

  // =========================================================================
  // Sources
  // =========================================================================

  sourcesPage(doc, ctx, report) {
    const sources = report.sources || [];

    this.h1(doc, ctx, 'Reference List', {
      icon: 'news',
      follows: 22 + this.flowHeight(doc, sources[0]?.title || '', { size: 9, indent: 30, lineGap: 2.2 }),
    });

    if (!sources.length) {
      this.emptyNote(doc, ctx);
      return;
    }

    this.paragraph(doc, ctx, 'Numbered references cited throughout this report.', {
      size: 9,
      color: C.muted,
    });
    this.space(doc, 4);

    const indent = 30;

    sources.forEach(source => {
      const title = source.title || 'Untitled';
      const meta = [
        source.source,
        source.publishedAt ? this.formatDate(source.publishedAt) : null,
        // Why this source is here, not just what kind of thing it is. A reader
        // scanning the list can tell a filed result from a press mention
        // without opening either.
        CITATION_REASONS[source.reason] || source.type,
        source.originalPublisher ? `originally ${source.originalPublisher}` : null,
      ].filter(Boolean).join('  ·  ');

      const titleOptions = {
        size: 9,
        color: C.body,
        indent,
        lineGap: 2.2,
        link: source.url || undefined,
      };
      const metaOptions = { size: 7.8, color: C.muted, indent, lineGap: 1.6 };

      // A reference number stranded from its title is worse than useless
      this.fitBlock(doc, ctx,
        this.flowHeight(doc, title, titleOptions)
        + (meta ? this.flowHeight(doc, meta, metaOptions) : 0));

      // Hanging label: writing it moves the cursor, so the title goes back up
      const top = doc.y;
      doc.font(F.bold).fontSize(8).fillColor(C.blue)
        .text(`[${source.index}]`, MARGIN, top + 0.8, { width: indent - 4, lineBreak: false });
      doc.y = top;

      this.writeText(doc, title, titleOptions);

      if (meta) {
        this.writeText(doc, meta, metaOptions);
      }

      this.space(doc, 8);
    });
  }

  /**
   * The brief this report was written against, plus the score arithmetic. At
   * the back because a reader only reaches for it to answer "why does this
   * report say what it says".
   */
  reportContextSection(doc, ctx, report, meta = {}) {
    const context = report.context || {};
    const score = report.score || {};

    const rows = [
      ['Prepared for', context.sellerName || meta.seller?.name],
      ['Priority topics', (context.priorityTopics || []).join(', ')],
      ['Other monitored topics', (context.topics || []).join(', ')],
      ['Your capabilities', (context.sellerCapabilities || []).join(', ')],
      ['Your value propositions', (context.sellerValuePropositions || []).join(', ')],
      ['Technologies', (context.technologies || []).join(', ')],
      ['Target industries', (context.targetIndustries || []).join(', ')],
      ['Target departments', (context.targetDepartments || []).join(', ')],
      ['Account added', this.day(report.accountAddedAt || meta.company?.addedAt)],
      ['Report generated', this.moment(report.generatedAt)],
      // Regenerating writes a new report, so for this one the two are minutes
      // apart; lastUpdatedAt is when the pipeline finished writing it
      ['Last refreshed', this.moment(report.lastUpdatedAt || report.generatedAt)],
      ['Written by', report.aiModel],
    ].filter(([, value]) => value);

    const breakdown = score.breakdown || {};
    const bars = Object.entries(SCORE_LABELS)
      .filter(([key]) => typeof breakdown[key] === 'number');
    const reasons = (score.reasons || []).filter(Boolean);

    if (!rows.length && !bars.length && !reasons.length) return;

    this.h1(doc, ctx, 'How This Report Was Built', { follows: 40 });
    this.paragraph(doc, ctx, 'Every claim above was written against the profile below, frozen at the moment the report was generated. Editing the profile afterwards does not change this document.', {
      size: 9,
      color: C.muted,
    });

    // --- Score arithmetic ---
    if (bars.length || reasons.length) {
      this.h3(doc, ctx, 'Salesmotion Score Breakdown', {
        follows: bars.length ? bars.length * 22 : this.listOpener(doc, reasons),
      });

      const barWidth = 300;
      bars.forEach(([key, label]) => {
        this.ensure(doc, ctx, 24);
        const value = Math.max(0, Math.min(100, Math.round(breakdown[key])));
        const top = doc.y;

        doc.font(F.regular).fontSize(8).fillColor(C.muted)
          .text(label.toUpperCase(), MARGIN, top, { width: barWidth - 30, characterSpacing: 0.5, lineBreak: false });
        doc.font(F.bold).fontSize(8).fillColor(C.ink)
          .text(String(value), MARGIN + barWidth - 30, top, { width: 30, align: 'right', lineBreak: false });

        const barY = top + 11;
        doc.save();
        doc.roundedRect(MARGIN, barY, barWidth, 4, 2).fill(C.track);
        doc.roundedRect(MARGIN, barY, Math.max(2, barWidth * value / 100), 4, 2).fill(this.scoreColor(value));
        doc.restore();

        doc.y = barY + 13;
      });

      if (reasons.length) {
        this.space(doc, 4);
        this.bulletList(doc, ctx, reasons.map(text => ({ text })), { icon: 'dot', color: C.blue });
      }
    }

    // --- Profile rows ---
    if (rows.length) {
      this.h3(doc, ctx, 'Report Profile', { follows: 24 });

      rows.forEach(([label, value]) => {
        const options = { size: 9.5, color: C.ink, indent: 0, lineGap: 2.2 };

        // A field name and its value are one row, never two halves
        this.fitBlock(doc, ctx, 13 + this.flowHeight(doc, value, options));

        doc.font(F.bold).fontSize(7.6).fillColor(C.muted)
          .text(label.toUpperCase(), MARGIN, doc.y, {
            width: CONTENT_WIDTH,
            characterSpacing: 0.6,
          });
        this.space(doc, 2.5);

        this.writeText(doc, value, options);
        this.space(doc, 10);
      });
    }
  }
}

module.exports = new ReportGenerator();
