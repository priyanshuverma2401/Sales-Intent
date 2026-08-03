# SalesMotion — B2B Account Intelligence

A multi-tenant sales-intelligence platform. Companies subscribe, their employees claim seats,
and every account report is written through **what that company sells** and **what that
individual rep pitches**.

---

## The model

There are three inputs, and every report is a function of all three.

| Input | Captured at | Example |
|---|---|---|
| **Company capabilities** | Company registration | Intelligent automation, Data & analytics, AI/ML engineering |
| **Vertical capabilities** | Employee signup | KYC/AML automation, Credit risk analytics |
| **Pitch keywords** | Employee signup (overridable per account) | GenAI solutions, Copilot solutions |

The keywords are the primary lens. A rep pitching *GenAI* and *Copilot* who adds **Microsoft**
does not get a generic Microsoft profile — they get a report that answers *"where does Microsoft
need GenAI and Copilot, and how do we prove it?"*, with every insight tied back to that.

---

## Flow

```
1. Company registers          → capabilities, value props, proof points, target industries
   POST /api/auth/register-organization
        ↓ the admin's email domain becomes the team's sign-up key

2. Employee creates account   → vertical, vertical capabilities, pitch keywords
   POST /api/auth/register     (blocked unless their domain belongs to a subscriber)

3. Employee adds a prospect   → optional per-account keyword override
   POST /api/companies         → report generation starts automatically

4. Report                     → viewable in the app, exportable as PDF
   GET  /api/reports/:id
   GET  /api/reports/:id/download
```

---

## What a report contains

Grouped exactly as the three page-sets of the printed brief.

**What You Need To Know** — Salesmotion score, Key Insights, Opportunities, Challenges,
People Updates, Top News, Talking Points, Executive Perspective

**Research & Analysis** — Company Overview, Key People Changes, Key Projects, Aspirations,
Business Goals, Opportunities, Macroeconomic Perspective, Recent Press, Business Model
(Revenue Streams / Go-to-Market / ICP), Strategic Initiatives, Financials, SWOT

**Value** — Three Whys (Why Change / Why Now / Why You), Value Pyramid (Company Goals /
Business Strategy / Challenges / Value Paths), Value Proposition Ideas, Value Hypothesis,
Point of View

**Sources** — every claim carries `[n]` footnote markers pointing at a numbered source list.

### Salesmotion score

Transparent arithmetic, not an AI guess, so the number is stable between runs and the reasons
can be shown to the user. Weighted 0–100 across:

| Component | Weight | What it measures |
|---|---|---|
| Keyword fit | 35 | Does their public activity match what you pitch |
| Buying signals | 20 | Earnings, M&A, funding, executive moves |
| Hiring signals | 20 | Are they hiring into your target departments |
| News momentum | 15 | Is anything happening, recently |
| Financial context | 10 | Can they fund it |

Bands: **Priority** (80+), **Strong** (60+), **Developing** (40+), **Watch** (below 40).

---

## Quick start

```bash
# 1. Backend
cd backend
npm install
cp .env.example .env      # fill in MONGODB_URI and GROQ_API_KEY
npm run dev               # http://localhost:5000

# 2. Frontend
cd frontend
npm install
npm start                 # http://localhost:3000
```

Then open http://localhost:3000 and choose **Set up your organisation**. There are no seeded
demo credentials — the first company you register creates the first account.

### Required environment

| Variable | Required | Notes |
|---|---|---|
| `MONGODB_URI` | yes | Local or Atlas. All app data lives here. |
| `GROQ_API_KEY` | yes | Report generation returns HTTP 503 without it. |
| `JWT_SECRET` | yes | Change it before deploying. |
| `NEWS_API_KEY` | no | Adds a second news source; Google News RSS works without it. |
| `FINNHUB_API_KEY` | no | Adds financials and stock data for ticker-matched accounts. |
| `FRONTEND_URL` | no | CORS allowlist, defaults to `http://localhost:3000`. |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | no | Optional SQL layer; the app boots fine without it. |

`COMPANY_DOMAINS` is no longer used. Access is decided by which subscribing organisation owns
the email domain.

### Cost per report

A full report is roughly **25k tokens** across four AI passes and takes **~2 minutes**. Groq's
free tier allows 100k tokens/day, so about **3–4 reports per day**. Past that the app reports a
clear "daily token allowance is used up" message rather than failing silently.

---

## Architecture

```
backend/src/
  models/
    Organization.js        tenant: capabilities, value props, domains, seats
    User.js                seat: vertical, vertical capabilities, keywords, accounts
    Report.js              full section schema, citations, score, sources
  services/
    aiEngine.js            four batched JSON passes, all sharing the seller lens
    intelligenceService.js evidence → sources → normalise → report shape
    reportService.js       the "generate a report" use case, run in background
    reportGenerator.js     A4-landscape PDF, running chrome, footnotes, quote cards
    scoring.js             Salesmotion score
  routes/
    auth · organizations · companies · accounts · reports · signals · alerts · inbox

frontend/src/
  components/  ui.tsx (primitives) · Layout · AuthShell · AddAccountModal · ReportSections
  pages/       Login · Signup · OrgRegister · Dashboard · Accounts · Reports
               ReportDetail · Settings · Signals · Alerts · Inbox
  lib/         taxonomy.ts (vertical & capability suggestions)
```

### Notable behaviours

- **Reports are personal.** The same prospect produces a different report for a different
  seller. Only the author (or an org admin) can read one.
- **Per-account lens.** Keywords set when adding an account override the profile default, so one
  rep can chase Copilot at Microsoft and cost-takeout at HSBC.
- **Keyword-targeted research.** One extra news feed per keyword (`"Microsoft Copilot"`) runs
  alongside the general company feed, and those hits are ranked first in the source list.
- **Source filtering.** Articles that never name the company are dropped before the model sees
  them, because it will otherwise cite them.
- **No fabricated quotes.** Executive Perspective drops anything unattributed, duplicated, or
  matching a refusal phrase. An absent section beats an invented quote in a client-facing brief.
- **Stored PDFs.** Downloads serve the file on disk; the AI pipeline never re-runs on a download.

---

## Data sources

Google News RSS · NewsAPI · Finnhub · Yahoo Finance · SEC EDGAR · Wikipedia · Indeed · Groq

## Requirements

Node 16+ · MongoDB (local or Atlas) · ~500 MB disk
