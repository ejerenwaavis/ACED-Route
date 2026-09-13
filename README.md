# ACED Route

Driver routing, navigation, and machine-learning sequence platform for **ACED Division LLC**.

## Architecture & Layout

This project follows a unified single-unit development structure:

- **`client/`** — React mobile-first driver application (touch-friendly UI, CSV manifest parser, interactive route map, turn-by-turn navigation launcher, and mark-complete workflow).
- **`public_html/`** — Top-level build destination for the React app. The Express server serves this statically for web/browser clients, and Capacitor syncs it into the Android native shell.
- **`server/`** — Express + MongoDB REST API (OAuth authentication, canonical geocoded addresses, manifests, brand lookup, and `RouteEdge` learning graph).
- **`mobile/`** — Capacitor native Android shell with location permissions and Google Maps SDK placeholders.

---

## 1. Quick Start

### Install Dependencies
```bash
# In the root workspace:
npm install --prefix server
npm install --prefix client
npm install --prefix mobile
```

### Build Frontend & Sync to Android
```bash
# Builds client into public_html and syncs with Capacitor Android:
npm run build
```

### Configure Server Environment
```bash
cd server
cp .env.example .env
```
Fill in `.env`:
- `MONGODB_URI` — Connection string for the shared ACED Mongo database.
- `JWT_SECRET` — Strong random secret for token signing.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — From your Google Cloud OAuth Web Application client.
- `GOOGLE_CALLBACK_URL` — `https://route.aceddivision.com/api/auth/googleLoggedIn` (byte-for-byte matching your Google Cloud Console registered redirect URI).
- `GOOGLE_MAPS_API_KEY` — Google Maps / Navigation SDK key.

### Start the API Server
```bash
npm run start:server
# Or with nodemon for live-reload:
npm run dev:server
```
Visit `http://localhost:3000` to access the web driver UI directly!

---

## 2. Google OAuth & Domain Note

The production domain is **`route.aceddivision.com`**.
In your Google Cloud Console OAuth 2.0 Web Application client:
- **Authorised JavaScript origins**:
  - `http://localhost:3000`
  - `https://route.aceddivision.com`
- **Authorised redirect URIs**:
  - `http://localhost:3000/api/auth/googleLoggedIn`
  - `https://route.aceddivision.com/api/auth/googleLoggedIn`

---

## 3. Running the Android App

```bash
cd mobile
npx cap open android
```
This opens the project in Android Studio.

### Maps SDK Key in Android
`mobile/android/app/build.gradle` is already wired to inject `${GOOGLE_MAPS_API_KEY}` from `gradle.properties`:
In `mobile/android/gradle.properties`:
```properties
GOOGLE_MAPS_API_KEY=your-api-key-here
```
*(Note: `gradle.properties` is gitignored so secrets are never committed).*

---

## 4. Built Screens & Capabilities

1. **Manifest Upload Screen** (`POST /api/manifest`):
   - Drag & drop CSV/TSV or paste raw dispatch data.
   - Column auto-detection (Tracking Number, Address, Locality).
   - "Load Sample Route" button for quick testing.
   - Live stop preview table and geocoding progress indicator.
2. **Route Sequencer Screen** (`GET /api/manifest/:id/suggest`):
   - Displays suggested stop order based on the driver's learned `RouteEdge` graph.
   - Manual Move Up / Move Down buttons for any stops before departing.
   - Interactive route map showing the sequence of stops.
3. **Turn-by-Turn Map & Navigation Screen**:
   - Active stop card with destination address and locality.
   - Automatic brand detection badge via `/api/brand/find/:tracking`.
   - Gate code & driver notes display with instant "+ Add Gate Code" editing.
   - Large **"Navigate in Google Maps"** button (triggers native Android `google.navigation:` intent with web directions fallback).
4. **"Mark Complete" Flow** (`POST /api/manifest/:id/complete`):
   - "Delivered" and "Skip / Attempt" actions with automatic advance to the next stop.
   - When the route concludes, submits the final order to `/api/manifest/:id/complete`, upserting `RouteEdge` weights to train future automatic sequencing!
5. **Manifest History**:
   - Browse past and active delivery manifests to review or resume progress.
