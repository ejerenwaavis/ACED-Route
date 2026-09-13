require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const passport = require('./config/passport');

const path = require('path');

const authRoutes = require('./routes/auth');
const brandRoutes = require('./routes/brand');
const manifestRoutes = require('./routes/manifest');

const app = express();

app.use(cors());
app.use(express.json());
app.use(passport.initialize());

app.use('/api/auth', authRoutes);
app.use('/api/brand', brandRoutes);
app.use('/api/manifest', manifestRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Serve frontend static build from public_html if present
const publicHtmlPath = path.join(__dirname, '../public_html');
app.use(express.static(publicHtmlPath));

// SPA fallback for client-side routing
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  const indexPath = path.join(publicHtmlPath, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) next();
  });
});

const requiredEnv = ['MONGODB_URI', 'JWT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL'];
const missing = requiredEnv.filter((k) => !process.env[k]);
if (missing.length) {
  console.warn(`[aced-route] Missing env vars: ${missing.join(', ')} — see .env.example`);
}

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('[aced-route] Mongo connected — one database, shared across all ACED apps');
    const port = process.env.PORT || 3000;
    app.listen(port, () => console.log(`[aced-route] listening on :${port}`));
  })
  .catch((err) => {
    console.error('[aced-route] Mongo connection failed:', err.message);
    process.exit(1);
  });
