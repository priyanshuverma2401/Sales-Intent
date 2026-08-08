const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Design tokens - kept in one place so the PDF and the web report stay in step
// ---------------------------------------------------------------------------
const PAGE = { width: 841.89, height: 595.28 }; // A4 landscape
const MARGIN = 46;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;

// The page is 750pt wide. Set as one measure that is ~150 characters a line,
// which is roughly twice what anyone reads comfortably, so the body runs in two
// columns instead. Every block below flows through the column machinery.
const COLUMNS = 2;
const GUTTER = 34;
const COL_WIDTH = (CONTENT_WIDTH - GUTTER * (COLUMNS - 1)) / COLUMNS;

const HEADER_RULE_Y = 62;
const BODY_TOP = 86;
const FOOTER_RULE_Y = PAGE.height - 56;
const BODY_BOTTOM = FOOTER_RULE_Y - 20;
const COLUMN_HEIGHT = BODY_BOTTOM - BODY_TOP;

const C = {
  page: '#f7f9fc',
  surface: '#ffffff',
  ink: '#0b1b34',
  body: '#334155',
  muted: '#8494ab',
  line: '#e3e9f2',
  track: '#dde5f0',
  brand: '#1d4ed8',
  brandDark: '#0f2f6b',
  brandSoft: '#eef3fd',
  link: '#2563eb',
  amber: '#d97706',
  green: '#059669',
  red: '#dc2626',
  purple: '#7c3aed',
  teal: '#0e7490',
  white: '#ffffff',
};

const F = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
  italic: 'Helvetica-Oblique',
};

// Body copy is set once here so every block shares the same vertical rhythm
const BODY_SIZE = 9.4;
const BODY_GAP = 2.8;

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

    // ctx carries the running header label plus the column cursor, so chrome can
    // be redrawn and the flow restarted whenever a page is added
    const ctx = {
      group: '',
      groupIndex: 0,
      company: report.companyName,
      date: this.formatDate(report.generatedAt || new Date()),
      firstPage: true,
      col: 0,
      colTop: BODY_TOP,
      // The topic a spilling column is carrying on from, so it can be named
      section: null,
      subsection: null,
      toc: [],
      tocPageIndex: null,
    };

    // Blocks are measured and split before they are drawn, so pdfkit should
    // never need to break a page by itself. If it ever does - a single
    // unbreakable word taller than a column, say - this hook keeps the page
    // furnished and drops the cursor back into the first column rather than
    // leaving the flow writing into the footer.
    doc.on('pageAdded', () => {
      this.drawChrome(doc, ctx);
      ctx.col = 0;
      ctx.colTop = BODY_TOP;
    });

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

    // Both passes reach back into pages that were written earlier, so they have
    // to run while the buffer is still open
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
    this.withoutMargins(doc, () => {
      this.paintBackground(doc);
      this.drawHeader(doc, ctx);
      this.drawFooter(doc, ctx);
    });
  }

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

  drawHeader(doc, ctx) {
    if (!ctx.group) return;

    doc.save();
    doc.font(F.bold).fontSize(7.5).fillColor(C.brand)
      .text(ctx.group.toUpperCase(), MARGIN, 42, {
        width: CONTENT_WIDTH / 2,
        characterSpacing: 1.1,
        lineBreak: false,
      });
    doc.font(F.regular).fontSize(8.5).fillColor(C.muted)
      .text(ctx.company, MARGIN + CONTENT_WIDTH / 2, 41.5, {
        width: CONTENT_WIDTH / 2,
        align: 'right',
        lineBreak: false,
      });

    doc.moveTo(MARGIN, HEADER_RULE_Y).lineTo(PAGE.width - MARGIN, HEADER_RULE_Y)
      .lineWidth(0.75).strokeColor(C.line).stroke();
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

    doc.font(F.regular).fontSize(8).fillColor(C.muted);
    doc.text(ctx.date, PAGE.width - MARGIN - 240, baseY + 2, {
      width: 240,
      align: 'right',
      lineBreak: false,
    });
    doc.restore();
  }

  // Page numbers need the total, which is only known once the last page exists
  stampPageNumbers(doc, ctx) {
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
  // Column flow
  // =========================================================================

  colX(ctx) {
    return MARGIN + ctx.col * (COL_WIDTH + GUTTER);
  }

  newPage(doc, ctx) {
    if (ctx.firstPage) {
      // The first page is never "added", so it needs its chrome drawn directly
      ctx.firstPage = false;
      this.drawChrome(doc, ctx);
    } else {
      doc.addPage(); // the pageAdded hook draws the chrome and resets the column
    }

    ctx.col = 0;
    ctx.colTop = BODY_TOP;
    doc.x = MARGIN;
    doc.y = BODY_TOP;
    this.continuationLabel(doc, ctx);
  }

  nextColumn(doc, ctx) {
    if (ctx.col < COLUMNS - 1) {
      ctx.col += 1;
      doc.x = this.colX(ctx);
      doc.y = ctx.colTop;
      this.continuationLabel(doc, ctx);
    } else {
      this.newPage(doc, ctx);
    }
  }

  /**
   * Names the topic a column is carrying on from.
   *
   * Two columns read down-then-across, so copy that spills out of the left
   * column reappears at the top of the right one with the *next* topic's
   * heading sitting under it - which reads as though it belongs there. The
   * label says whose words these are before the reader guesses.
   *
   * `ctx.section` is cleared by `h1` before it looks for room, so a column
   * opened to make space for a new heading is not labelled with the old one.
   */
  continuationLabel(doc, ctx) {
    if (!ctx.section) return;

    const trail = [ctx.section, ctx.subsection].filter(Boolean).join('  ·  ');

    doc.font(F.bold).fontSize(7).fillColor(C.muted)
      .text(`${trail}  ·  CONTINUED`.toUpperCase(), this.colX(ctx), doc.y, {
        width: COL_WIDTH,
        characterSpacing: 0.8,
        lineBreak: false,
      });

    doc.y += 15;
  }

  room(doc) {
    return BODY_BOTTOM - doc.y;
  }

  // Usable height of a fresh column starting where this one does. Mid-topic it
  // is shorter, because the next column opens with a "continued" label.
  columnHeight(ctx) {
    return BODY_BOTTOM - ctx.colTop - (ctx.section ? 15 : 0);
  }

  // Break to the next column when the block will not fit in what is left
  need(doc, ctx, height) {
    if (height > this.room(doc)) {
      this.nextColumn(doc, ctx);
      return true;
    }
    return false;
  }

  /**
   * Places a block of known height without cutting it in half.
   *
   * A bullet that would be split across two columns is moved whole to the next
   * one instead. Only copy too tall for any column is split, and then only if
   * enough of it can start here to be worth reading.
   */
  fitBlock(doc, ctx, height, minLines = 3) {
    if (height <= this.room(doc)) return;

    if (height <= this.columnHeight(ctx)) {
      this.nextColumn(doc, ctx);
      return;
    }

    const line = this.lineHeight(doc, BODY_SIZE);
    if (this.room(doc) < line * minLines) this.nextColumn(doc, ctx);
  }

  space(doc, amount) {
    doc.y += amount;
  }

  atColumnTop(doc, ctx) {
    return doc.y <= ctx.colTop + 0.5;
  }

  startGroup(doc, ctx, label) {
    ctx.group = label;
    ctx.groupIndex += 1;
    ctx.section = null;
    ctx.subsection = null;
    this.newPage(doc, ctx);
    ctx.toc.push({ level: 0, label, page: this.pageNumber(doc) });
    this.groupBanner(doc, ctx, label);
  }

  // Full-width title strip above the columns on the first page of a group
  groupBanner(doc, ctx, label) {
    doc.font(F.bold).fontSize(7.5).fillColor(C.brand)
      .text(`PART ${ctx.groupIndex}`, MARGIN, BODY_TOP - 4, {
        width: CONTENT_WIDTH,
        characterSpacing: 1.4,
      });
    doc.font(F.bold).fontSize(22).fillColor(C.ink)
      .text(label, MARGIN, doc.y + 3, { width: CONTENT_WIDTH });

    const ruleY = doc.y + 12;
    doc.save()
      .moveTo(MARGIN, ruleY).lineTo(PAGE.width - MARGIN, ruleY)
      .lineWidth(0.75).strokeColor(C.line).stroke()
      .restore();

    // Every column on this page starts below the strip; a later page resets to
    // BODY_TOP through the pageAdded hook
    ctx.col = 0;
    ctx.colTop = ruleY + 18;
    doc.x = MARGIN;
    doc.y = ctx.colTop;
  }

  // =========================================================================
  // Text flow
  //
  // Long copy is split across columns here rather than left to pdfkit, which
  // only knows about pages. Everything is measured first, so a block never runs
  // past the bottom of its column.
  // =========================================================================

  lineHeight(doc, size, lineGap = BODY_GAP) {
    doc.fontSize(size);
    return doc.currentLineHeight(true) + lineGap;
  }

  /**
   * Largest word boundary at which `text` still fits in `avail`.
   * Prefix height grows monotonically with length, so this bisects.
   */
  splitIndex(doc, text, width, lineGap, avail) {
    const bounds = [];
    const spaces = /\s+/g;
    let match;
    while ((match = spaces.exec(text)) !== null) bounds.push(match.index);
    if (!bounds.length) return -1;

    let lo = 0;
    let hi = bounds.length - 1;
    let best = -1;

    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const height = doc.heightOfString(text.slice(0, bounds[mid]), { width, lineGap });
      if (height <= avail) {
        best = bounds[mid];
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    return best;
  }

  /**
   * Writes wrapped copy at the column cursor, spilling into the next column
   * when it runs out of room. Citation chips are appended to the final line.
   */
  flow(doc, ctx, text, options = {}) {
    const {
      font = F.regular,
      size = BODY_SIZE,
      color = C.body,
      lineGap = BODY_GAP,
      indent = 0,
      characterSpacing = 0,
      align = 'left',
      link,
      citations = [],
      // Set when the caller has already drawn something at this cursor - a
      // bullet marker, a reference number - that the first line must stay with
      anchored = false,
    } = options;

    const value = String(text || '').trim();
    if (!value) return;

    const width = COL_WIDTH - indent;
    const setFont = () => doc.font(font).fontSize(size);

    setFont();
    const line = this.lineHeight(doc, size, lineGap);
    // The chips wrap onto their own line in the worst case, so the last chunk
    // keeps a line in hand for them
    const tail = citations.length ? line : 0;

    // Unanchored copy can still be moved whole; anchored copy was placed by its
    // caller, which measured it first
    if (!anchored) {
      setFont();
      this.fitBlock(doc, ctx, doc.heightOfString(value, { width, lineGap }) + tail);
    }

    let rest = value;
    let first = true;
    let guard = 0;

    while (rest && guard++ < 400) {
      setFont();

      // A block that cannot show at least two lines reads as an orphan
      if (!(anchored && first) && this.room(doc) < line * 2 && !this.atColumnTop(doc, ctx)) {
        this.nextColumn(doc, ctx);
        continue;
      }

      const x = this.colX(ctx) + indent;
      const avail = this.room(doc);
      const height = doc.heightOfString(rest, { width, lineGap });

      if (height <= avail - tail) {
        doc.fillColor(color).text(rest, x, doc.y, {
          width,
          lineGap,
          align,
          characterSpacing,
          link,
          continued: citations.length > 0,
        });

        if (citations.length) {
          doc.font(F.bold).fontSize(6.8).fillColor(C.link)
            .text(`  ${citations.map(n => `[${n}]`).join(' ')}`, {
              lineGap,
              characterSpacing: 0,
            });
        }
        return;
      }

      const cut = this.splitIndex(doc, rest, width, lineGap, avail);

      if (cut <= 0) {
        if (!this.atColumnTop(doc, ctx)) {
          // Not even one line fits at this cursor - take a fresh column
          this.nextColumn(doc, ctx);
          continue;
        }

        // A whole empty column is not enough: an unbroken run longer than the
        // column, a single 400-character URL. Nothing can be gained by moving
        // it again, so it is handed to pdfkit whole rather than looped on.
        doc.fillColor(color).text(rest, x, doc.y, {
          width,
          lineGap,
          align,
          characterSpacing,
          link,
        });
        return;
      }

      doc.fillColor(color).text(rest.slice(0, cut), x, doc.y, {
        width,
        lineGap,
        align,
        characterSpacing,
        link,
      });

      rest = rest.slice(cut).replace(/^\s+/, '');
      first = false;
      this.nextColumn(doc, ctx);
    }
  }

  // Height `flow` will occupy, so a caller can place the block before drawing
  // any marker that has to travel with it
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
    const height = doc.heightOfString(value, { width: COL_WIDTH - indent, lineGap });

    return height + (citations.length ? this.lineHeight(doc, size, lineGap) : 0);
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

  /**
   * Section title. The space above it is what keeps a heading off the tail of
   * the block before - `moveDown` used to be measured in the 7pt citation font
   * that had just been set, which left almost none.
   */
  h1(doc, ctx, text, follows = 0) {
    // Closed before the search for room: a column opened for this heading is
    // starting the new topic, not carrying on the old one
    ctx.section = null;
    ctx.subsection = null;

    if (!this.atColumnTop(doc, ctx)) this.space(doc, 20);

    // Hold the title back unless the block under it comes too - a heading alone
    // at the foot of a column reads as a dead end. `follows` is that block's
    // measured height; the cap stops an unusually long opener from pushing
    // every heading onto a column of its own.
    const line = this.lineHeight(doc, BODY_SIZE);
    const keep = Math.min(Math.max(follows, line * 3), this.columnHeight(ctx) * 0.55);

    // Measured, not guessed: a reserve a point short of the truth lets the
    // heading through and strands it when the block underneath is then moved
    doc.font(F.bold).fontSize(15);
    const headingHeight = 10 + doc.heightOfString(text, { width: COL_WIDTH }) + 8;

    this.need(doc, ctx, headingHeight + keep);

    ctx.toc.push({ level: 1, label: text, page: this.pageNumber(doc) });

    const x = this.colX(ctx);
    doc.save().rect(x, doc.y, 24, 2.5).fill(C.brand).restore();
    doc.y += 10;

    doc.font(F.bold).fontSize(15).fillColor(C.ink)
      .text(text, x, doc.y, { width: COL_WIDTH });

    ctx.section = text;
    this.space(doc, 8);
  }

  /**
   * Subsection label inside a section. `follows` is the height of the first
   * block underneath it, so the label is not left behind on its own.
   */
  h3(doc, ctx, text, color = C.brand, follows = 0) {
    ctx.subsection = null;

    if (!this.atColumnTop(doc, ctx)) this.space(doc, 12);

    const keep = Math.min(
      follows || this.lineHeight(doc, BODY_SIZE) * 2,
      this.columnHeight(ctx) * 0.6,
    );
    this.need(doc, ctx, 16 + keep);

    doc.font(F.bold).fontSize(8.2).fillColor(color)
      .text(String(text).toUpperCase(), this.colX(ctx), doc.y, {
        width: COL_WIDTH,
        characterSpacing: 0.8,
      });

    ctx.subsection = text;
    this.space(doc, 4);
  }

  /**
   * One evidence-backed line: coloured marker, wrapped body text, then the
   * citation chips the sample decks put at the end of each claim.
   */
  bullet(doc, ctx, item, { color = C.brand, indent = 14, size = BODY_SIZE } = {}) {
    const text = typeof item === 'string' ? item : item?.text;
    if (!text) return;

    const citations = (typeof item === 'object' && Array.isArray(item.citations)) ? item.citations : [];
    const options = { size, indent, citations };

    // Settle the column before the marker is drawn: it cannot follow the text,
    // and a claim split down the middle is what makes two columns hard to read
    this.fitBlock(doc, ctx, this.flowHeight(doc, text, options));

    doc.save();
    doc.circle(this.colX(ctx) + 3.4, doc.y + size * 0.56, 2.4).fill(color);
    doc.restore();

    this.flow(doc, ctx, text, { ...options, anchored: true });
    this.space(doc, 7);
  }

  // ---- Openers -----------------------------------------------------------
  // What a heading needs to keep beside it: the height of the first block of
  // whatever follows. Each returns 0 for an empty section, which leaves `h1`
  // and `h3` on their default minimum.

  bulletHeight(doc, item, { indent = 14, size = BODY_SIZE } = {}) {
    const text = typeof item === 'string' ? item : item?.text;
    if (!text) return 0;

    const citations = (typeof item === 'object' && Array.isArray(item.citations)) ? item.citations : [];
    return this.flowHeight(doc, text, { size, indent, citations });
  }

  listOpener(doc, items, options) {
    const first = (items || []).filter(Boolean)[0];
    return first ? this.bulletHeight(doc, first, options) : 0;
  }

  // A subsection opener is its label plus the first claim beneath it
  subsectionsOpener(doc, groups) {
    const first = (groups || []).find(([, items]) => (items || []).filter(Boolean).length);
    return first ? 20 + this.listOpener(doc, first[1]) : 0;
  }

  bulletList(doc, ctx, items, options = {}) {
    const list = (items || []).filter(Boolean);

    if (!list.length) {
      this.emptyNote(doc, ctx);
      return;
    }

    list.forEach(item => this.bullet(doc, ctx, item, options));
  }

  /**
   * A talking point is a small script rather than a bullet: a headline to find
   * it by, the spoken body, then the ask / proof / objection cues. Each element
   * flows independently so a long point runs on instead of being squeezed.
   */
  talkingPointHeight(doc, item) {
    const point = typeof item === 'string' ? { text: item } : (item || {});
    const body = point.text || '';
    const indent = 24;

    const heading = point.headline || this.truncate(body, 90);
    let total = this.flowHeight(doc, heading, { font: F.bold, size: 9.6, indent, lineGap: 1.8 })
      + 4
      + this.flowHeight(doc, body, {
        indent,
        citations: Array.isArray(point.citations) ? point.citations : [],
      });

    for (const cue of [point.question, point.proof, point.objection]) {
      if (cue) total += 18 + this.flowHeight(doc, cue, { size: 8.8, indent: indent + 2, lineGap: 2.4 });
    }

    return total;
  }

  talkingPoint(doc, ctx, item, index) {
    const point = typeof item === 'string' ? { text: item } : (item || {});
    const body = point.text || '';
    if (!body && !point.headline) return;

    const citations = Array.isArray(point.citations) ? point.citations : [];
    const indent = 24;

    if (index > 0) this.space(doc, 6);

    const heading = point.headline || this.truncate(body, 90);
    const headingOptions = { font: F.bold, size: 9.6, indent, lineGap: 1.8 };
    const bodyOptions = { indent, citations };

    // A talking point is read aloud as one piece, so it is placed as one piece:
    // headline, body and all three cues move together whenever they can
    this.fitBlock(doc, ctx, this.talkingPointHeight(doc, item), 4);

    const top = doc.y;
    const x = this.colX(ctx);

    doc.save();
    doc.roundedRect(x, top - 1, 17, 14, 3.5).fill(C.brandSoft);
    doc.font(F.bold).fontSize(8).fillColor(C.brand)
      .text(String(index + 1), x, top + 3, { width: 17, align: 'center', lineBreak: false });
    doc.restore();
    doc.y = top;

    this.flow(doc, ctx, heading, { ...headingOptions, color: C.brandDark, anchored: true });

    this.space(doc, 4);

    if (body) {
      this.flow(doc, ctx, body, bodyOptions);
    }

    this.cueLine(doc, ctx, 'ASK', point.question, C.brand, indent);
    this.cueLine(doc, ctx, 'PROOF', point.proof, C.green, indent);
    this.cueLine(doc, ctx, 'IF THEY PUSH BACK', point.objection, C.amber, indent);

    this.space(doc, 12);
  }

  /**
   * Cue label above its body rather than inline: at column width an inline
   * "IF THEY PUSH BACK" label eats most of the first line.
   */
  cueLine(doc, ctx, label, text, color, baseIndent) {
    if (!text) return;

    const indent = baseIndent + 2;
    const options = { size: 8.8, indent, lineGap: 2.4 };

    this.space(doc, 6);

    // The cue is the label plus what it says; neither means much alone
    this.fitBlock(doc, ctx, 12 + this.flowHeight(doc, text, options));

    doc.font(F.bold).fontSize(7.2).fillColor(color)
      .text(label, this.colX(ctx) + indent, doc.y, {
        width: COL_WIDTH - indent,
        characterSpacing: 0.9,
      });

    this.space(doc, 2);
    this.flow(doc, ctx, text, { ...options, anchored: true });
  }

  talkingPointList(doc, ctx, items) {
    const list = (items || []).filter(Boolean);

    if (!list.length) {
      this.emptyNote(doc, ctx);
      return;
    }

    list.forEach((item, i) => this.talkingPoint(doc, ctx, item, i));
  }

  emptyNote(doc, ctx) {
    this.flow(doc, ctx, 'No supporting evidence was found for this section.', {
      font: F.italic,
      size: 8.8,
      color: C.muted,
      indent: 14,
    });
    this.space(doc, 7);
  }

  paragraph(doc, ctx, text, options = {}) {
    if (!text) return;
    this.flow(doc, ctx, text, options);
    this.space(doc, 7);
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
    if (value >= 60) return C.brand;
    if (value >= 40) return C.amber;
    return C.muted;
  }

  // =========================================================================
  // Cover
  // =========================================================================

  coverPage(doc, ctx, report, meta) {
    ctx.group = '';
    this.newPage(doc, ctx);
    // The cover is laid out at fixed coordinates rather than flowed, so the
    // margins come off: every writer below stops at the footer by measuring,
    // and nothing here should ever be able to spill onto a page of its own.
    this.withoutMargins(doc, () => this.drawCover(doc, report, meta));
  }

  drawCover(doc, report, meta) {
    const facts = report.fastFacts || {};
    const score = report.score || {};

    // --- Hero band -------------------------------------------------------
    const badgeSize = 104;
    const badgeX = PAGE.width - MARGIN - badgeSize;
    const titleWidth = CONTENT_WIDTH - badgeSize - 40;

    doc.font(F.bold).fontSize(7.5).fillColor(C.brand)
      .text('SALES INTELLIGENCE REPORT', MARGIN, 52, {
        width: titleWidth,
        characterSpacing: 1.5,
      });

    doc.font(F.bold).fontSize(32).fillColor(C.ink)
      .text(report.companyName, MARGIN, doc.y + 6, { width: titleWidth });

    const subtitle = [
      this.hostname(facts.website),
      facts.industry,
      (report.ticker || facts.ticker) ? `NYSE/LSE: ${report.ticker || facts.ticker}` : null,
    ].filter(Boolean).join('   ·   ');

    doc.font(F.regular).fontSize(10).fillColor(C.muted)
      .text(subtitle, MARGIN, doc.y + 4, { width: titleWidth });

    if (score.value) this.scoreBadge(doc, score, badgeX, 50, badgeSize);

    const ruleY = 172;
    doc.save()
      .moveTo(MARGIN, ruleY).lineTo(PAGE.width - MARGIN, ruleY)
      .lineWidth(0.75).strokeColor(C.line).stroke()
      .restore();

    // --- Three columns below the rule ------------------------------------
    const colW = (CONTENT_WIDTH - 60) / 3;
    const colX = i => MARGIN + i * (colW + 30);
    const top = ruleY + 24;

    this.coverAbout(doc, colX(0), top, colW, facts);
    this.coverScore(doc, colX(1), top, colW, score);
    this.coverLinks(doc, colX(2), top, colW, report, facts, meta);
  }

  coverHeading(doc, text, x, y, width) {
    doc.font(F.bold).fontSize(11.5).fillColor(C.ink)
      .text(text, x, y, { width });
    const ruleY = doc.y + 5;
    doc.save()
      .moveTo(x, ruleY).lineTo(x + width, ruleY)
      .lineWidth(0.75).strokeColor(C.line).stroke()
      .restore();
    return ruleY + 11;
  }

  /**
   * Cover columns are fixed boxes rather than flowing copy. Every block is
   * measured against the footer first and skipped whole if it does not fit, so
   * the cover can never push a half-empty continuation page out behind it.
   */
  coverFits(y, height) {
    return y + height <= BODY_BOTTOM - 4;
  }

  coverText(doc, text, x, y, width, options = {}) {
    const { font = F.regular, size = 8.8, color = C.body, lineGap = 2.4, gap = 0 } = options;
    if (!text) return y;

    doc.font(font).fontSize(size);
    const height = doc.heightOfString(text, { width, lineGap });
    if (!this.coverFits(y, height)) return null;

    doc.fillColor(color).text(text, x, y, { width, lineGap, link: options.link });
    return doc.y + gap;
  }

  coverAbout(doc, x, y, width, facts) {
    let cursor = this.coverHeading(doc, 'About', x, y, width);

    if (facts.description) {
      const next = this.coverText(doc, this.truncate(facts.description, 400), x, cursor, width, { gap: 12 });
      if (next === null) return;
      cursor = next;
    }

    const revenue = this.money(facts.revenue, facts.revenueCurrency);
    const rows = [
      ['Headquarters', facts.headquarters],
      ['Industry', facts.industry],
      ['Revenue', revenue ? `${revenue}${facts.revenueAsOf ? ` (FY${facts.revenueAsOf})` : ''}` : null],
      ['Employees', facts.employees ? Number(facts.employees).toLocaleString() : null],
      ['Market cap', this.money(facts.marketCap)],
      ['Founded', facts.founded ? String(facts.founded) : null],
      ['Fiscal year starts', facts.fiscalYearStart],
    ].filter(([, value]) => value);

    const labelWidth = 92;

    for (const [label, value] of rows) {
      doc.font(F.regular).fontSize(9.2);
      const height = doc.heightOfString(value, { width: width - labelWidth, lineGap: 1.5 });
      if (!this.coverFits(cursor, height)) return;

      doc.font(F.regular).fontSize(8).fillColor(C.muted)
        .text(label.toUpperCase(), x, cursor + 1, {
          width: labelWidth,
          characterSpacing: 0.5,
          lineBreak: false,
        });
      doc.font(F.regular).fontSize(9.2).fillColor(C.ink)
        .text(value, x + labelWidth, cursor, { width: width - labelWidth, lineGap: 1.5 });

      cursor = doc.y + 7;
    }
  }

  coverScore(doc, x, y, width, score) {
    if (!score.value && !score.summary) return;

    let cursor = this.coverHeading(doc, 'Salesmotion Score', x, y, width);

    if (score.summary) {
      const next = this.coverText(doc, score.summary, x, cursor, width, { gap: 14 });
      if (next === null) return;
      cursor = next;
    }

    // --- Breakdown bars ---
    const breakdown = score.breakdown || {};
    const entries = Object.entries(SCORE_LABELS)
      .filter(([key]) => typeof breakdown[key] === 'number');

    for (const [key, label] of entries) {
      if (!this.coverFits(cursor, 23)) break;
      const value = Math.max(0, Math.min(100, Math.round(breakdown[key])));

      doc.font(F.regular).fontSize(7.6).fillColor(C.muted)
        .text(label.toUpperCase(), x, cursor, { width: width - 30, characterSpacing: 0.5, lineBreak: false });
      doc.font(F.bold).fontSize(7.6).fillColor(C.ink)
        .text(String(value), x + width - 30, cursor, { width: 30, align: 'right', lineBreak: false });

      const barY = cursor + 10;
      doc.save();
      doc.roundedRect(x, barY, width, 4, 2).fill(C.track);
      doc.roundedRect(x, barY, Math.max(2, width * value / 100), 4, 2).fill(this.scoreColor(value));
      doc.restore();

      cursor = barY + 13;
    }

    // --- Why this score ---
    const reasons = (score.reasons || []).filter(Boolean);
    if (!reasons.length) return;

    // The label is only worth drawing if the first reason lands under it
    doc.font(F.regular).fontSize(8.4);
    const firstReason = doc.heightOfString(reasons[0], { width: width - 11, lineGap: 1.8 });
    if (!this.coverFits(cursor + 4, 22 + firstReason)) return;

    cursor += 4;
    doc.font(F.bold).fontSize(7.6).fillColor(C.brand)
      .text('WHY THIS SCORE', x, cursor, { width, characterSpacing: 0.9 });
    cursor = doc.y + 6;

    for (const reason of reasons) {
      doc.font(F.regular).fontSize(8.4);
      const height = doc.heightOfString(reason, { width: width - 11, lineGap: 1.8 });
      if (!this.coverFits(cursor, height)) return;

      doc.save().circle(x + 2.4, cursor + 4.4, 1.9).fill(C.brand).restore();
      doc.font(F.regular).fontSize(8.4).fillColor(C.body)
        .text(reason, x + 11, cursor, { width: width - 11, lineGap: 1.8 });
      cursor = doc.y + 5;
    }
  }

  /**
   * Third cover column: where to read more, plus the three facts a reader
   * checks before trusting the document. The rest of the brief that produced it
   * is set out in full by `reportContextSection` at the back.
   */
  coverLinks(doc, x, y, width, report, facts, meta) {
    let cursor = this.coverHeading(doc, 'Quick Links', x, y, width);

    // Reports written before the homepage was fetched hold it only in
    // fastFacts, so it is merged in rather than missing from the cover
    const links = [...(report.quickLinks || [])];
    if (facts.website && !links.some(l => this.hostname(l.url) === this.hostname(facts.website))) {
      links.unshift({ label: this.hostname(facts.website), url: facts.website });
    }

    for (const link of links.slice(0, 7)) {
      const next = this.coverText(doc, link.label, x, cursor, width, {
        size: 9,
        color: C.link,
        lineGap: 1.5,
        link: link.url,
        gap: 5,
      });
      if (next === null) break;
      cursor = next;
    }

    const context = report.context || {};
    const rows = [
      ['Prepared for', context.sellerName || meta.seller?.name],
      ['Account added', this.day(report.accountAddedAt || meta.company?.addedAt)],
      // Regenerating writes a new report, so for this one the two are minutes
      // apart; lastUpdatedAt is when the pipeline finished writing it
      ['Last refreshed', this.moment(report.lastUpdatedAt || report.generatedAt)],
    ].filter(([, value]) => value);

    if (!rows.length) return;

    doc.font(F.regular).fontSize(8.8);
    const firstRow = doc.heightOfString(rows[0][1], { width, lineGap: 1.6 }) + 11;
    if (!this.coverFits(cursor + 16, 30 + firstRow)) return;

    cursor = this.coverHeading(doc, 'Report Details', x, cursor + 16, width);

    for (const [label, value] of rows) {
      doc.font(F.regular).fontSize(8.8);
      const height = doc.heightOfString(value, { width, lineGap: 1.6 }) + 11;
      if (!this.coverFits(cursor, height)) return;

      doc.font(F.bold).fontSize(7.4).fillColor(C.muted)
        .text(label.toUpperCase(), x, cursor, { width, characterSpacing: 0.6 });
      doc.font(F.regular).fontSize(8.8).fillColor(C.ink)
        .text(value, x, doc.y + 1.5, { width, lineGap: 1.6 });
      cursor = doc.y + 8;
    }
  }

  scoreBadge(doc, score, x, y, size) {
    const colour = this.scoreColor(score.value);

    doc.save();
    doc.roundedRect(x, y, size, size, 14).fill(C.surface);
    doc.roundedRect(x, y, size, size, 14).lineWidth(1).strokeColor(C.line).stroke();

    doc.font(F.bold).fontSize(36).fillColor(colour)
      .text(String(score.value), x, y + 20, { width: size, align: 'center' });
    doc.font(F.bold).fontSize(8).fillColor(C.ink)
      .text((score.band || '').toUpperCase(), x, y + 61, { width: size, align: 'center', characterSpacing: 0.8 });

    doc.save().moveTo(x + 26, y + 76).lineTo(x + size - 26, y + 76)
      .lineWidth(0.75).strokeColor(C.line).stroke().restore();

    doc.font(F.regular).fontSize(7).fillColor(C.muted)
      .text('SALESMOTION SCORE', x, y + 83, { width: size, align: 'center', characterSpacing: 0.5 });
    doc.restore();
  }

  // =========================================================================
  // Contents
  //
  // The page is claimed up front and filled in at the end, once every section
  // knows which page it landed on.
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
      doc.font(F.bold).fontSize(22).fillColor(C.ink)
        .text('Contents', MARGIN, BODY_TOP - 4, { width: CONTENT_WIDTH });

      const ruleY = doc.y + 12;
      doc.save()
        .moveTo(MARGIN, ruleY).lineTo(PAGE.width - MARGIN, ruleY)
        .lineWidth(0.75).strokeColor(C.line).stroke()
        .restore();

      const top = ruleY + 20;
      let col = 0;
      let cursor = top;

      const x = () => MARGIN + col * (COL_WIDTH + GUTTER);

      ctx.toc.forEach(entry => {
        const height = entry.level === 0 ? 30 : 17;
        if (cursor + height > BODY_BOTTOM) {
          if (col >= COLUMNS - 1) return; // more sections than the page can list
          col += 1;
          cursor = top;
        }

        const isGroup = entry.level === 0;
        if (isGroup && cursor > top) cursor += 10;

        const indent = isGroup ? 0 : 14;
        const numberWidth = 28;
        const labelWidth = COL_WIDTH - indent - numberWidth - 6;

        doc.font(isGroup ? F.bold : F.regular)
          .fontSize(isGroup ? 10.5 : 9.2)
          .fillColor(isGroup ? C.ink : C.body)
          .text(entry.label, x() + indent, cursor, { width: labelWidth, lineBreak: false });

        doc.font(isGroup ? F.bold : F.regular).fontSize(isGroup ? 10.5 : 9.2)
          .fillColor(isGroup ? C.brand : C.muted)
          .text(String(entry.page), x() + COL_WIDTH - numberWidth, cursor, {
            width: numberWidth,
            align: 'right',
            lineBreak: false,
          });

        cursor += isGroup ? 20 : 17;
      });
    });
  }

  // =========================================================================
  // Group 1 — What You Need To Know
  // =========================================================================

  executiveBriefPages(doc, ctx, report) {
    const brief = report.executiveBrief || {};

    this.h1(doc, ctx, 'Key Insights', this.listOpener(doc, brief.keyInsights));
    this.bulletList(doc, ctx, brief.keyInsights, { color: C.amber });

    this.h1(doc, ctx, 'Opportunities', this.listOpener(doc, brief.opportunities));
    this.bulletList(doc, ctx, brief.opportunities, { color: C.green });

    this.h1(doc, ctx, 'Challenges', this.listOpener(doc, brief.challenges));
    this.bulletList(doc, ctx, brief.challenges, { color: C.red });

    this.h1(doc, ctx, 'People Updates', this.listOpener(doc, brief.peopleUpdates));
    this.bulletList(doc, ctx, brief.peopleUpdates, { color: C.purple });

    const news = (brief.topNews || []).filter(n => n?.title);
    this.h1(doc, ctx, 'Top News', this.newsItemHeight(doc, news[0]));
    this.newsList(doc, ctx, brief.topNews);

    const points = (brief.talkingPoints || []).filter(Boolean);
    this.h1(doc, ctx, 'Talking Points', points[0] ? this.talkingPointHeight(doc, points[0]) : 0);
    this.talkingPointList(doc, ctx, brief.talkingPoints);

    if (brief.executivePerspective?.length) {
      this.h1(doc, ctx, 'Executive Perspective',
        this.quoteCardHeight(doc, brief.executivePerspective[0]));
      brief.executivePerspective.forEach(q => this.quoteCard(doc, ctx, q));
    }
  }

  newsParts(item) {
    const indent = 14;

    return {
      indent,
      summary: item.summary ? this.truncate(item.summary, 320) : '',
      meta: [item.source, item.publishedAt ? this.formatDate(item.publishedAt) : null]
        .filter(Boolean).join('  ·  '),
      titleOptions: {
        font: F.bold,
        size: 9.4,
        color: C.ink,
        indent,
        lineGap: 1.8,
        link: item.url || undefined,
      },
      summaryOptions: {
        size: 8.8,
        indent,
        lineGap: 2.2,
        citations: Array.isArray(item.citations) ? item.citations : [],
      },
      metaOptions: { size: 7.4, color: C.muted, indent },
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
      const { indent, summary, meta, titleOptions, summaryOptions, metaOptions } =
        this.newsParts(item);

      // Headline, summary and byline are one story - they move together
      this.fitBlock(doc, ctx, this.newsItemHeight(doc, item));

      doc.save();
      doc.circle(this.colX(ctx) + 3.4, doc.y + 5.2, 2.4).fill(C.teal);
      doc.restore();

      this.flow(doc, ctx, item.title, { ...titleOptions, anchored: true });

      if (summary) {
        this.space(doc, 3);
        this.flow(doc, ctx, summary, summaryOptions);
      }

      if (meta) {
        this.space(doc, 3);
        this.flow(doc, ctx, meta, metaOptions);
      }

      this.space(doc, 10);
    });
  }

  /**
   * Quotes sit on a tinted card. A quote taller than a column would have no
   * card to sit on, so in that case it is split and each part gets its own.
   */
  quoteCardHeight(doc, quote) {
    if (!quote?.quote) return 0;

    const attribution = [quote.person, quote.title, quote.source].filter(Boolean).join(', ');
    doc.font(F.italic).fontSize(9.6);

    return doc.heightOfString(`“${String(quote.quote).trim()}”`, {
      width: COL_WIDTH - 13 * 2 - 3,
      lineGap: 2.4,
    }) + 26 + (attribution ? 16 : 0);
  }

  quoteCard(doc, ctx, quote) {
    const padding = 13;
    const accent = 3;
    const inner = COL_WIDTH - padding * 2 - accent;
    const attribution = [quote.person, quote.title, quote.source].filter(Boolean).join(', ');
    const citations = Array.isArray(quote.citations) ? quote.citations : [];

    const body = `“${String(quote.quote || '').trim()}”`;
    if (!quote.quote) return;

    // A quote broken over two cards reads as two quotes, so one that fits in a
    // fresh column is moved there whole
    this.fitBlock(doc, ctx, this.quoteCardHeight(doc, quote));

    let rest = body;
    let guard = 0;

    while (rest && guard++ < 40) {
      doc.font(F.italic).fontSize(9.6);
      const lineGap = 2.4;
      const line = this.lineHeight(doc, 9.6, lineGap);

      // The attribution only rides along with the closing part of the quote
      const footHeight = attribution ? 16 : 0;
      let avail = this.room(doc) - padding * 2 - footHeight;

      if (avail < line * 2) {
        this.nextColumn(doc, ctx);
        continue;
      }

      const full = doc.heightOfString(rest, { width: inner, lineGap });
      const isLast = full <= avail;
      let chunk = rest;

      if (!isLast) {
        const cut = this.splitIndex(doc, rest, inner, lineGap, this.room(doc) - padding * 2);
        if (cut <= 0) {
          if (this.atColumnTop(doc, ctx)) {
            // See the note in `flow`: an unbroken run this long cannot be
            // placed by moving it. The card is what gets dropped, not the words
            this.flow(doc, ctx, rest, { font: F.italic, size: 9.6, color: C.ink, lineGap });
            if (attribution) {
              this.flow(doc, ctx, `— ${attribution}`, { font: F.bold, size: 8, color: C.brandDark, citations });
            }
            this.space(doc, 12);
            return;
          }
          this.nextColumn(doc, ctx);
          continue;
        }
        chunk = rest.slice(0, cut);
      }

      const textHeight = doc.heightOfString(chunk, { width: inner, lineGap });
      const cardHeight = textHeight + padding * 2 + (isLast ? footHeight : 0);
      const top = doc.y;
      const x = this.colX(ctx);

      doc.save();
      doc.roundedRect(x, top, COL_WIDTH, cardHeight, 7).fill(C.brandSoft);
      doc.roundedRect(x, top, accent, cardHeight, 1.5).fill(C.brand);
      doc.restore();

      doc.font(F.italic).fontSize(9.6).fillColor(C.ink)
        .text(chunk, x + accent + padding, top + padding, { width: inner, lineGap });

      if (isLast && attribution) {
        doc.font(F.bold).fontSize(8).fillColor(C.brandDark)
          .text(`— ${attribution}`, x + accent + padding, top + cardHeight - padding - 4, {
            width: inner,
            lineBreak: false,
            continued: citations.length > 0,
          });
        if (citations.length) {
          doc.font(F.bold).fontSize(6.8).fillColor(C.link)
            .text(`  ${citations.map(n => `[${n}]`).join(' ')}`, { lineBreak: false });
        }
      }

      doc.y = top + cardHeight;
      rest = isLast ? '' : rest.slice(chunk.length).replace(/^\s+/, '');
      if (rest) this.nextColumn(doc, ctx);
    }

    this.space(doc, 12);
  }

  // =========================================================================
  // Group 2 — Research & Analysis
  // =========================================================================

  researchPages(doc, ctx, report) {
    const r = report.research || {};

    this.subsectionSection(doc, ctx, 'Insights', [
      ['Company Overview', r.companyOverview],
      ['Key People Changes', r.keyPeopleChanges, C.purple],
      ['Key Projects', r.keyProjects],
      ['Aspirations', r.aspirations],
      ['Business Goals', r.businessGoals],
      ['Opportunities', r.opportunities, C.green],
      ['Macroeconomic Perspective', r.macroPerspective, C.teal],
      ['Recent Press Announcements', r.recentPress],
    ]);

    this.subsectionSection(doc, ctx, 'Business Model', [
      ['Revenue Streams', r.businessModel?.revenueStreams],
      ['Go-to-Market Strategy', r.businessModel?.goToMarket],
      ['Ideal Customer Profile', r.businessModel?.idealCustomerProfile],
    ]);

    this.h1(doc, ctx, 'Strategic Initiatives', this.listOpener(doc, r.strategicInitiatives));
    this.bulletList(doc, ctx, r.strategicInitiatives, { color: C.brand });

    this.h1(doc, ctx, 'Financials', this.listOpener(doc, r.financials));
    this.bulletList(doc, ctx, r.financials, { color: C.teal });

    this.subsectionSection(doc, ctx, 'SWOT Analysis', [
      ['Strengths', r.swot?.strengths, C.green],
      ['Weaknesses', r.swot?.weaknesses, C.red],
      ['Opportunities', r.swot?.opportunities, C.brand],
      ['Threats', r.swot?.threats, C.amber],
    ]);
  }

  // A section built from labelled subsections. Grouping them lets the title
  // measure the first claim it has to keep beside it.
  subsectionSection(doc, ctx, title, groups) {
    this.h1(doc, ctx, title, this.subsectionsOpener(doc, groups));
    groups.forEach(([label, items, color]) => this.subsection(doc, ctx, label, items, color));
  }

  subsection(doc, ctx, title, items, color = C.brand) {
    const first = (items || []).filter(Boolean)[0];
    const text = typeof first === 'string' ? first : first?.text;

    // Measure the first claim so the label travels with it
    const follows = text
      ? this.flowHeight(doc, text, {
        indent: 14,
        citations: (typeof first === 'object' && first.citations) || [],
      })
      : 0;

    this.h3(doc, ctx, title, color, follows);
    this.bulletList(doc, ctx, items, { color });
  }

  // =========================================================================
  // Group 3 — Value
  // =========================================================================

  valuePages(doc, ctx, report) {
    const v = report.value || {};

    this.subsectionSection(doc, ctx, 'Three Whys', [
      ['Why Change', v.whyChange, C.purple],
      ['Why Now', v.whyNow, C.amber],
      ['Why You', v.whyYou, C.green],
    ]);

    this.subsectionSection(doc, ctx, 'Value Pyramid', [
      ['Company Goals', v.valuePyramid?.companyGoals],
      ['Business Strategy', v.valuePyramid?.businessStrategy],
      ['Challenges and Obstacles', v.valuePyramid?.challengesObstacles, C.red],
      ['Value Paths', v.valuePyramid?.valuePaths, C.teal],
    ]);

    if (v.valuePropositions?.length) {
      const propParts = (prop, idx) => ({
        title: `${idx + 1}. ${prop.title}`,
        titleOptions: { font: F.bold, size: 10, color: C.ink, lineGap: 1.8 },
        bodyOptions: {
          indent: 14,
          citations: Array.isArray(prop.citations) ? prop.citations : [],
        },
      });

      const propHeight = (prop, idx) => {
        const { title, titleOptions, bodyOptions } = propParts(prop, idx);
        return this.flowHeight(doc, title, titleOptions) + 4
          + this.flowHeight(doc, prop.body, bodyOptions);
      };

      this.h1(doc, ctx, 'Value Proposition Ideas', propHeight(v.valuePropositions[0], 0));

      v.valuePropositions.forEach((prop, idx) => {
        const { title, titleOptions, bodyOptions } = propParts(prop, idx);

        this.fitBlock(doc, ctx, propHeight(prop, idx));

        this.flow(doc, ctx, title, { ...titleOptions, anchored: true });
        this.space(doc, 4);

        this.flow(doc, ctx, prop.body, bodyOptions);
        this.space(doc, 11);
      });
    }

    this.h1(doc, ctx, 'Value Hypothesis', this.listOpener(doc, v.hypotheses));
    this.bulletList(doc, ctx, v.hypotheses, { color: C.purple });

    this.h1(doc, ctx, 'Point of View', this.listOpener(doc, v.pointOfView));
    this.bulletList(doc, ctx, v.pointOfView, { color: C.brand });
  }

  // =========================================================================
  // Sources
  // =========================================================================

  sourcesPage(doc, ctx, report) {
    const sources = report.sources || [];

    this.h1(doc, ctx, 'Reference List', 20 + this.flowHeight(doc, sources[0]?.title || '', {
      size: 8.6,
      indent: 26,
      lineGap: 1.8,
    }));

    if (!sources.length) {
      this.emptyNote(doc, ctx);
      return;
    }

    this.paragraph(doc, ctx, 'Numbered references cited throughout this report.', {
      size: 8.8,
      color: C.muted,
    });

    const indent = 26;

    sources.forEach(source => {
      const title = source.title || 'Untitled';
      const meta = [
        source.source,
        source.publishedAt ? this.formatDate(source.publishedAt) : null,
        source.type,
      ].filter(Boolean).join('  ·  ');

      const titleOptions = {
        size: 8.6,
        color: C.body,
        indent,
        lineGap: 1.8,
        link: source.url || undefined,
      };
      const metaOptions = { size: 7.4, color: C.muted, indent, lineGap: 1.4 };

      // A reference number stranded from its title is worse than useless
      this.fitBlock(doc, ctx,
        this.flowHeight(doc, title, titleOptions)
        + (meta ? this.flowHeight(doc, meta, metaOptions) : 0));

      // The marker is a hanging label, not a line of its own: writing it moves
      // the cursor, so the title is put back on the same line
      const top = doc.y;
      doc.font(F.bold).fontSize(7.8).fillColor(C.link)
        .text(`[${source.index}]`, this.colX(ctx), top + 0.8, { width: indent - 4, lineBreak: false });
      doc.y = top;

      this.flow(doc, ctx, title, { ...titleOptions, anchored: true });

      if (meta) {
        this.flow(doc, ctx, meta, metaOptions);
      }

      this.space(doc, 7);
    });
  }

  /**
   * The brief this report was written against. It lives at the back rather than
   * on the cover because it runs to a dozen fields, and a reader only reaches
   * for it to answer "why does this report say what it says".
   */
  reportContextSection(doc, ctx, report, meta = {}) {
    const context = report.context || {};

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
      ['Last refreshed', this.moment(report.lastUpdatedAt || report.generatedAt)],
      ['Written by', report.aiModel],
    ].filter(([, value]) => value);

    if (!rows.length) return;

    this.h1(doc, ctx, 'How This Report Was Built',
      40 + this.flowHeight(doc, rows[0][1], { size: 9, lineGap: 1.8 }));
    this.paragraph(doc, ctx, 'Every claim above was written against the profile below, frozen at the moment the report was generated. Editing the profile afterwards does not change this document.', {
      size: 8.8,
      color: C.muted,
    });

    rows.forEach(([label, value]) => {
      const options = { size: 9, color: C.ink, lineGap: 1.8 };

      // A field name and its value are one row, never two halves
      this.fitBlock(doc, ctx, 12 + this.flowHeight(doc, value, options));

      doc.font(F.bold).fontSize(7.4).fillColor(C.muted)
        .text(label.toUpperCase(), this.colX(ctx), doc.y, {
          width: COL_WIDTH,
          characterSpacing: 0.6,
        });
      this.space(doc, 2);

      this.flow(doc, ctx, value, { ...options, anchored: true });
      this.space(doc, 9);
    });
  }
}

module.exports = new ReportGenerator();
