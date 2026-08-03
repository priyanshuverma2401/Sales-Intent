> **OUT OF DATE.** This guide predates the multi-tenant rewrite. Sign-in is no longer a
> fixed `abc.com` allowlist — companies register first, then their employees claim seats.
> See [README.md](README.md) for the current setup and flow.

# 🚀 Transfer SalesMotion to Another Laptop

## 📋 What to Copy

Copy this entire folder to your other laptop:
```
C:\Users\abhis\sales-motion-app\
```

## 📁 Files Structure to Copy

```
sales-motion-app/
├── backend/
│   ├── src/
│   ├── package.json          ← IMPORTANT
│   ├── .env                  ← IMPORTANT (has all API keys)
│   └── [other files]
│
├── frontend/
│   ├── src/
│   ├── package.json          ← IMPORTANT
│   └── [other files]
│
└── [documentation files]
```

---

## ⚠️ DO NOT Copy

- `backend/node_modules/` (too large)
- `frontend/node_modules/` (too large)
- `backend/database/` (database files)
- `.git/` if exists

---

## 🚀 Setup on Other Laptop

### 1. Copy Project
Copy the entire `sales-motion-app` folder to the new laptop

### 2. Install MongoDB Locally
- Download: https://www.mongodb.com/try/download/community
- Install for Windows (MSI)
- This creates local MongoDB service

### 3. Install Backend Dependencies
```powershell
cd sales-motion-app/backend
npm install
```

### 4. Start Backend
```powershell
npm run dev
```

Should show:
```
✅ MongoDB connected
✅ SQLite connected
🚀 Server running on http://localhost:5000
```

### 5. Install Frontend Dependencies (new terminal)
```powershell
cd sales-motion-app/frontend
npm install
```

### 6. Start Frontend
```powershell
npm start
```

Opens: http://localhost:3000

---

## 🔐 .env File (Already Configured)

Your `.env` has:
```
✅ Groq API Key
✅ NewsAPI Key
✅ Finnhub API Key
✅ MongoDB (set to local): mongodb://localhost:27017/salesmotion
✅ Company Domain: abc.com
```

No changes needed!

---

## ✅ Verification

After setup, you should see:
- Backend running on http://localhost:5000
- Frontend running on http://localhost:3000
- Login with: john@abc.com / SecurePassword123!

---

## 📝 Quick Checklist

- [ ] Copy entire project folder
- [ ] Install MongoDB locally
- [ ] Run `npm install` in backend
- [ ] Run `npm install` in frontend
- [ ] Start backend with `npm run dev`
- [ ] Start frontend with `npm start`
- [ ] Test login at http://localhost:3000

---

Done! Same working app on the new laptop 🎉
