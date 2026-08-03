> **OUT OF DATE.** This guide predates the multi-tenant rewrite. Sign-in is no longer a
> fixed `abc.com` allowlist — companies register first, then their employees claim seats.
> See [README.md](README.md) for the current setup and flow.

# SalesMotion Clone - Setup Guide

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ installed
- MongoDB running locally (or create MongoDB Atlas account for cloud)
- API Keys (see below)

---

## 📋 Required API Keys

### 1. **Groq API Key** ✅ (Already have)
```
GROQ_API_KEY=<your-groq-api-key>
```

### 2. **NewsAPI Key** ⏳ NEED THIS
- **Get from**: https://newsapi.org
- **Steps**:
  1. Go to https://newsapi.org
  2. Click "Get API Key"
  3. Sign up with email
  4. Copy your API key
  5. Paste in `.env` file as `NEWS_API_KEY=your-key`

### 3. **Finnhub API Key** ⏳ NEED THIS
- **Get from**: https://finnhub.io
- **Steps**:
  1. Go to https://finnhub.io
  2. Click "Get Free API"
  3. Sign up with email
  4. Copy your API key from dashboard
  5. Paste in `.env` file as `FINNHUB_API_KEY=your-key`

---

## 💾 Database Setup

### Option A: Local MongoDB
```bash
# Install MongoDB locally: https://www.mongodb.com/try/download/community

# Or use Docker:
docker run -d -p 27017:27017 -v mongo_data:/data/db --name mongodb mongo

# Connection string in .env:
MONGODB_URI=mongodb://localhost:27017/salesmotion
```

### Option B: MongoDB Atlas (Cloud - Free)
```bash
# 1. Go to https://www.mongodb.com/cloud/atlas
# 2. Create free account
# 3. Create cluster
# 4. Get connection string
# 5. Add to .env:
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/salesmotion
```

---

## 📦 Installation

### 1. Install Backend Dependencies
```bash
cd C:\Users\abhis\sales-motion-app\backend
npm install
```

### 2. Configure Environment
```bash
# Copy example and edit
cp .env.example .env

# Edit .env and add:
# - GROQ_API_KEY (you have this)
# - NEWS_API_KEY (get from newsapi.org)
# - FINNHUB_API_KEY (get from finnhub.io)
# - MONGODB_URI (local or cloud)
# - COMPANY_DOMAIN=abc.com
```

### 3. Start Backend
```bash
npm run dev
# Server will start on http://localhost:5000
```

---

## 🎨 Frontend Setup (Next Steps)

Will create after backend is running. Will use React + TypeScript.

---

## 🧪 Test Backend

```bash
# 1. Register
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@abc.com",
    "password": "password123",
    "company": "abc.com"
  }'

# 2. Login
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@abc.com",
    "password": "password123"
  }'

# 3. Search Companies (use token from login)
curl -X GET "http://localhost:5000/api/companies/search?q=Apple" \
  -H "Authorization: Bearer YOUR_TOKEN"

# 4. Add Company
curl -X POST http://localhost:5000/api/companies \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "name": "Apple Inc",
    "ticker": "AAPL"
  }'
```

---

## 📁 Project Structure

```
sales-motion-app/
├── backend/
│   ├── src/
│   │   ├── models/         # MongoDB schemas
│   │   ├── routes/         # API endpoints
│   │   ├── services/       # Business logic
│   │   │   ├── dataFetchers/  # News, Financial, Company data
│   │   │   ├── aiEngine.js    # Groq AI integration
│   │   │   └── reportGenerator.js  # PDF generation
│   │   ├── middleware/     # Auth, validation
│   │   └── server.js       # Express server
│   ├── package.json
│   ├── .env.example
│   └── .env (create this)
│
├── frontend/
│   └── (will create next)
│
└── reports/                # Generated PDF reports
    └── (auto-created)
```

---

## 🔑 Environment File Template

Create `backend/.env`:

```env
# Database
MONGODB_URI=mongodb://localhost:27017/salesmotion
SQLITE_PATH=./database/salesmotion.db

# Groq AI
GROQ_API_KEY=<your-groq-api-key>

# APIs (Get from below)
NEWS_API_KEY=xxx
FINNHUB_API_KEY=xxx

# Company Domain
COMPANY_DOMAIN=abc.com
COMPANY_DOMAINS=abc.com,example.com

# JWT
JWT_SECRET=your-secret-key-change-this

# Server
PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
```

---

## ✅ What's Built So Far

✅ **Backend Structure**:
- User authentication (email-based, company domain restricted)
- Company management (search, add, refresh data)
- Multi-source data fetchers (News, Financial, Company Info, Jobs)
- Groq AI integration for analysis
- PDF report generation
- Signals tracking
- Alerts system
- Inbox/Notifications
- SQLite + MongoDB support

✅ **Data Sources Integrated**:
- NewsAPI (news articles)
- Google News RSS (free news)
- Finnhub API (financial data)
- Yahoo Finance (stock prices)
- SEC EDGAR (financial filings)
- Wikipedia (company info)
- Indeed (job postings)

✅ **Features Ready**:
- User registration & login
- Company search & watchlist
- Real-time signal generation
- AI-powered insights via Groq
- PDF report generation
- Alert system
- Multi-source data aggregation

---

## 🚀 Next Steps

1. **Get API Keys** (NewsAPI, Finnhub)
2. **Setup MongoDB** (local or Atlas)
3. **Run Backend**: `npm run dev`
4. **Test Endpoints** using curl commands above
5. **Build Frontend** (React + TypeScript)

---

## ⚠️ Troubleshooting

### MongoDB Connection Error
```bash
# Make sure MongoDB is running
# Local: mongod
# Docker: docker ps (check if mongo container running)
```

### Port Already in Use
```bash
# Change PORT in .env or kill process using port 5000
```

### API Limit Errors
```bash
# Check API keys in .env
# Verify rate limits on respective API dashboards
```

---

## 📞 Support

Once you provide the API keys, everything will be ready to go!

