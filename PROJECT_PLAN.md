# SalesMotion Clone - Complete Project Plan

## Project Overview
Building a **Sales Intelligence Platform** that generates AI-powered sales reports with real-time signals about companies.

---

## 📊 Data Structure (Based on PDF Analysis)

### Report Sections:
1. **Quick Facts** - Company overview (employees, industry, HQ, location)
2. **Key Insights** - Bullet points on company developments
3. **Opportunities** - Specific business opportunities identified
4. **Challenges** - Problems/obstacles the company faces
5. **People Updates** - Recent hiring, executive changes
6. **Top News** - Latest news/announcements
7. **Talking Points** - Sales engagement talking points
8. **Executive Perspective** - Executive quotes/commentary
9. **Value Section**:
   - Why Change (pain points they have)
   - Why Now (timing/urgency)
   - Why You (why your solution fits)
   - Value Pyramid (Goals, Strategy, Challenges)
   - Value Paths (solutions offered)
   - Value Proposition (detailed proposals)
   - Value Hypothesis (business case)
   - Point of View (summary perspective)

---

## 🔗 Data Sources Required

### FREE Tier APIs & Services:
1. **News**: 
   - NewsAPI (1000 req/day free)
   - Newsdata.io (200 requests/day free)
   - Google News RSS
2. **Company Info**: 
   - Wikipedia API
   - Crunchbase (limited free)
   - Wikipedia Company pages
3. **Financial Data**:
   - SEC EDGAR (US filings)
   - Your Financial API (provided by user)
   - Finnhub (free tier)
   - Alpha Vantage (limited free)
4. **Jobs/Hiring Signals**:
   - LinkedIn Jobs (public data)
   - Indeed RSS feeds
   - Glassdoor data (scraping)
5. **People/Executive Changes**:
   - LinkedIn public profiles
   - Crunchbase
   - News sources
6. **Regulatory & Market Data**:
   - SEC EDGAR
   - OpenFIGI
   - Company House (UK)

---

## 🏗️ Tech Stack

### Frontend:
- **Framework**: React 18 + TypeScript
- **Styling**: TailwindCSS + Shadcn/UI
- **State**: Zustand or Redux
- **API Client**: Axios + React Query
- **Charts**: Recharts or Chart.js
- **PDF Export**: React-PDF or PDFKit

### Backend:
- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: MongoDB + SQLite (fallback)
- **Authentication**: JWT + Passport.js
- **AI Integration**: Anthropic Claude API
- **Job Queue**: Node-cron or Bull (for scheduled tasks)
- **Email**: Nodemailer (for alerts)

### DevOps:
- **Local Dev**: Docker Compose
- **Database**: MongoDB Atlas (free tier) or Local MongoDB
- **Environment**: .env configuration
- **API Keys**: Secured in environment variables

---

## 📋 Implementation Phases

### Phase 1: Foundation Setup
- [ ] Initialize project structure
- [ ] Setup MongoDB & SQLite
- [ ] Create data models
- [ ] Setup authentication system
- [ ] Build company search functionality

### Phase 2: Data Integration
- [ ] NewsAPI integration
- [ ] Company data API integration  
- [ ] Financial data integration
- [ ] Job posting integration
- [ ] People/Executive data fetching

### Phase 3: AI & Report Generation
- [ ] Claude API integration
- [ ] Signal analysis engine
- [ ] Report template creation
- [ ] PDF export functionality

### Phase 4: Frontend Development
- [ ] Dashboard layout
- [ ] Signals feed UI
- [ ] Accounts management
- [ ] Alerts system
- [ ] Inbox/Notifications
- [ ] Magic AI analysis page

### Phase 5: Refinement
- [ ] Performance optimization
- [ ] Testing
- [ ] Bug fixes
- [ ] Local deployment guide

---

## 🔑 Required Credentials

Please provide:
1. **Claude API Key** - Get from https://console.anthropic.com
2. **Financial Data API** - Your existing access (API key + endpoint)
3. **Company Email Domains** - List of valid domains for auth (e.g., google.com, microsoft.com)

Optional (can be configured later):
- NewsAPI key
- Finnhub key
- Crunchbase API key

---

## 📁 Project Structure

```
sales-motion-app/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── database.js
│   │   │   └── env.js
│   │   ├── models/
│   │   │   ├── User.js
│   │   │   ├── Company.js
│   │   │   ├── Signal.js
│   │   │   ├── Alert.js
│   │   │   └── Report.js
│   │   ├── controllers/
│   │   ├── routes/
│   │   ├── services/
│   │   │   ├── dataFetchers/
│   │   │   ├── aiEngine.js
│   │   │   └── reportGenerator.js
│   │   ├── middleware/
│   │   └── app.js
│   ├── .env.example
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   ├── hooks/
│   │   └── App.tsx
│   └── package.json
│
└── docs/
    ├── API.md
    └── SETUP.md
```

---

## ✅ Ready to Start!

Once you provide the required credentials, I'll begin building the complete application following this plan.

