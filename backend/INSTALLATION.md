> **OUT OF DATE.** This guide predates the multi-tenant rewrite. Sign-in is no longer a
> fixed `abc.com` allowlist — companies register first, then their employees claim seats.
> See [README.md](README.md) for the current setup and flow.

# Backend Installation & Testing

## 🚀 Quick Setup (5 minutes)

### Step 1: Install Dependencies
```bash
cd C:\Users\abhis\sales-motion-app\backend
npm install
```

### Step 2: Check .env File
Your `.env` file is ready with:
- ✅ Groq API Key
- ✅ NewsAPI Key  
- ✅ Finnhub API Key
- ⏳ MongoDB URI (update after MongoDB Atlas setup)

### Step 3: Start Backend
```bash
npm run dev
```

Expected output:
```
🚀 Server running on http://localhost:5000
✅ MongoDB connected
✅ SQLite connected
```

---

## 🔄 Update MongoDB After Atlas Setup

Once you have MongoDB Atlas connection string:

1. Open `backend/.env`
2. Find the line: `MONGODB_URI=mongodb://localhost:27017/salesmotion`
3. Replace with your Atlas connection string:
   ```
   MONGODB_URI=mongodb+srv://salesmotion_user:YOUR_PASSWORD@cluster0.xxxxx.mongodb.net/salesmotion?retryWrites=true&w=majority
   ```
4. Save and restart server

---

## 🧪 Test Endpoints

### 1. Health Check
```bash
curl http://localhost:5000/api/health
```

**Expected Response:**
```json
{"status":"Server is running"}
```

---

### 2. Register User (Company Email Only)
```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@abc.com",
    "password": "SecurePassword123!",
    "company": "ABC Corp"
  }'
```

**Expected Response:**
```json
{
  "message": "User registered successfully",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@abc.com",
    "company": "ABC Corp"
  }
}
```

---

### 3. Login
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@abc.com",
    "password": "SecurePassword123!"
  }'
```

**Save the token from response for next requests**

---

### 4. Search Companies
```bash
curl -X GET "http://localhost:5000/api/companies/search?q=Apple" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

**Expected Response:**
```json
[
  {
    "name": "Apple Inc",
    "ticker": "AAPL",
    "source": "Wikipedia",
    "snippet": "Apple Inc. is an American technology company..."
  }
]
```

---

### 5. Add Company to Watchlist
```bash
curl -X POST http://localhost:5000/api/companies \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "name": "Apple Inc",
    "ticker": "AAPL"
  }'
```

This will:
- ✅ Create company in database
- ✅ Fetch data from all sources
- ✅ Generate initial signals
- ✅ Add to your watchlist

---

### 6. Get Your Watchlist
```bash
curl -X GET http://localhost:5000/api/companies \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

---

### 7. Refresh Company Data
```bash
curl -X POST "http://localhost:5000/api/companies/COMPANY_ID/refresh" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

This will:
- 🔄 Fetch latest news
- 💰 Update financial data
- 💼 Check for new jobs
- 🧠 Generate new signals

---

### 8. Get Signals
```bash
curl -X GET "http://localhost:5000/api/signals" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

---

### 9. Generate Report (for a company)
```bash
curl -X POST "http://localhost:5000/api/reports/COMPANY_ID" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

This will:
- 🤖 Use Groq AI to analyze data
- 📄 Generate PDF report
- 💾 Save to database
- (Check `reports/` folder for PDF)

---

### 10. Download Report PDF
```bash
curl -X GET "http://localhost:5000/api/reports/REPORT_ID/download" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  --output report.pdf
```

---

## 🐛 Troubleshooting

### Error: "Cannot find module"
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### Error: "MongoDB connection failed"
- Make sure MongoDB is running (local) OR
- Update MONGODB_URI with Atlas connection string

### Error: "API rate limit exceeded"
- NewsAPI: 1000 requests/day (plenty for testing)
- Finnhub: Refresh less frequently
- Wait 24 hours for rate limit reset

### Error: "Invalid token"
- Token expires in 7 days
- Login again to get new token

---

## ✅ Success Checklist

- [ ] Backend running without errors
- [ ] Can register with abc.com email
- [ ] Can login successfully
- [ ] Can search for companies
- [ ] Can add company to watchlist
- [ ] Can see signals generated
- [ ] Can refresh company data
- [ ] Can generate reports
- [ ] Reports are saved as PDFs

---

## 📊 What Happens Automatically

When you add a company, the system:

1. **Searches Database** - Check if company exists
2. **Fetches Company Info** - Wikipedia, Crunchbase
3. **Gets Financial Data** - Finnhub, Yahoo Finance
4. **Fetches News** - NewsAPI, Google News RSS
5. **Finds Job Postings** - Indeed
6. **Generates Signals** - Creates signal records
7. **Analyzes with AI** - Groq analyzes each signal
8. **Stores Data** - Saves to MongoDB & SQLite

Total time: 10-30 seconds (depending on API response times)

---

## 🎯 Next: Frontend

After testing backend endpoints, I'll build:
- React dashboard
- Signals feed
- Company management
- Report viewer
- Alert system
- Full UI matching SalesMotion design

