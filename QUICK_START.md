> **OUT OF DATE.** This guide predates the multi-tenant rewrite. Sign-in is no longer a
> fixed `abc.com` allowlist — companies register first, then their employees claim seats.
> See [README.md](README.md) for the current setup and flow.

# 🚀 Quick Start - MongoDB Connected!

## ✅ MongoDB Credentials Set

Your MongoDB URI is now configured in `.env`:
```
mongodb+srv://priyanshu:Missionstartup%402026%23@salesintelligence.pgqleuo.mongodb.net/salesmotion
```

Database: **salesmotion**

---

## 📋 Setup Steps (5 minutes)

### Step 1: Initialize Database
```bash
cd C:\Users\abhis\sales-motion-app\backend
npm install
node src/scripts/initDatabase.js
```

**Expected Output:**
```
✅ Connected to MongoDB Atlas
📝 Creating collections...
✅ Users collection ready
✅ Companies collection ready
✅ Signals collection ready
✅ Reports collection ready
✅ Alerts collection ready
✅ Inbox collection ready
🎉 Ready to start the application!
```

---

### Step 2: Start Backend
```bash
npm run dev
```

**Expected Output:**
```
🚀 Server running on http://localhost:5000
✅ MongoDB connected
✅ SQLite connected
```

---

### Step 3: Start Frontend (new terminal)
```bash
cd C:\Users\abhis\sales-motion-app\frontend
npm install
npm start
```

**Opens automatically at**: http://localhost:3000

---

## 🔐 Create Test User

### Option 1: Register via UI
1. Go to http://localhost:3000
2. Click "Create Account"
3. Use any `@abc.com` email
4. Set password
5. Click "Create Account"

### Option 2: Use Demo Account
```
Email: john@abc.com
Password: SecurePassword123!
```

---

## ✨ You're Ready!

1. ✅ MongoDB connected
2. ✅ Backend running
3. ✅ Frontend running
4. ✅ Database initialized
5. 🎉 **Start adding companies and generating reports!**

---

## 📍 What Happens Next

1. **Search for company** (Apple, Microsoft, Google, etc.)
2. **Add to watchlist** - System fetches data automatically
3. **View signals** - See AI-generated insights
4. **Generate report** - Creates PDF with 9 sections
5. **Set alerts** - Get notified of important signals

---

## 🐛 If Issues Occur

### MongoDB Connection Error
```
❌ Check connection string in .env
❌ Verify IP whitelist in MongoDB Atlas allows your IP
❌ Check username/password special characters
```

### Collections Not Created
```bash
# Run init script again
node src/scripts/initDatabase.js
```

### Backend won't start
```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
npm run dev
```

---

## 📊 What's Running

```
Backend:   http://localhost:5000 (API)
Frontend:  http://localhost:3000 (Dashboard)
Database:  MongoDB Atlas Cloud (salesmotion database)
```

---

**Everything is set up and ready to go!** 🎉

