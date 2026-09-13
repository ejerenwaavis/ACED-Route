const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const passport = require('./config/passport');

const authRoutes = require('./routes/auth');
const brandRoutes = require('./routes/brand');
const manifestRoutes = require('./routes/manifest');
const regionsRoutes = require('./routes/regions');

const app = express();

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());
app.use(passport.initialize());

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/brand', brandRoutes);
app.use('/api/manifest', manifestRoutes);
app.use('/api/regions', regionsRoutes);
app.get('/api/health', (req, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

// Support sub-path mounting (e.g. /acedroute on shared cPanel domain)
const baseUri = process.env.BASE_URI || '/acedroute';
app.use(`${baseUri}/api/auth`, authRoutes);
app.use(`${baseUri}/api/brand`, brandRoutes);
app.use(`${baseUri}/api/manifest`, manifestRoutes);
app.use(`${baseUri}/api/regions`, regionsRoutes);
app.get(`${baseUri}/api/health`, (req, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

// Serve offline map region bundles (.zip, .pmtiles)
const regionsStaticPath = path.join(__dirname, 'public/regions');
app.use('/regions', express.static(regionsStaticPath));
app.use(`${baseUri}/regions`, express.static(regionsStaticPath));

// Serve frontend static build from public_html if present
const publicHtmlPath = path.join(__dirname, '../public_html');
app.use(`${baseUri}`, express.static(publicHtmlPath));
app.use(express.static(publicHtmlPath));

// SPA fallback for client-side routing
app.get('*', (req, res, next) => {
  if (req.path.includes('/api/')) return next();
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

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`[aced-route] listening on :${port}`);
});

if (process.env.MONGODB_URI) {
  mongoose
    .connect(process.env.MONGODB_URI)
    .then(() => {
      console.log('[aced-route] Mongo connected — one database, shared across all ACED apps');
    })
    .catch((err) => {
      console.error('[aced-route] Mongo connection failed:', err.message);
    });
} else {
  console.warn('[aced-route] MONGODB_URI not configured yet. Set in .env or cPanel Node environment variables.');
}
