---
name: deploy-aced-route
description: >
  Full deployment runbook for the ACED Route project: Vite web build, Android APK
  via GitHub CI, server-side SSH pull + restart on Namecheap, and APK side-loading
  to a local Android phone via the CrossDevice watched folder.
---

# ACED Route — Deployment Skill

## Architecture Overview

```
ACED Route/
  client/         ← React + Vite source
  public_html/    ← Vite build output (served by the Node app on Namecheap)
  server/         ← Node.js Express backend
  mobile/         ← Capacitor project root
  mobile/android/ ← Android / Gradle project
  .github/workflows/build-apk.yml  ← Full CI/CD pipeline
```

**Server:** `acedzagz@198.54.115.163:21098` (SSH alias: `aceddivision`)  
**App root on server:** `/home/acedzagz/acedroute/`  
**Web static root:** `/home/acedzagz/acedroute/public_html/` ← the subdomain `route.aceddivision.com` points HERE (NOT the cPanel public_html)  
**APK download URL:** `https://route.aceddivision.com/download/acedroute.apk`  
**GitHub Release (latest):** `https://github.com/ejerenwaavis/ACED-Route/releases/tag/latest-apk`

---

## Step 1 — Vite Web Build

Run from the project root or `client/` directory.

```powershell
cd "c:\Users\ejere\Documents\Projects SSD\Web Development\ACED Route\client"
npm run build
```

Build output goes to `../public_html/` (configured in `vite.config.js`). This is what the Node.js server on Namecheap serves.

> **Important:** Never build to the system-level `public_html`. Always build to the project-level `public_html/` inside the ACED Route folder.

---

## Step 2 — Android APK via GitHub CI

### Normal deploy path (push to git → CI builds APK automatically)

```powershell
cd "c:\Users\ejere\Documents\Projects SSD\Web Development\ACED Route"
git add -A
git commit -m "feat: describe your change"
git push origin main      # or pin-fix
```

GitHub Actions (`.github/workflows/build-apk.yml`) will automatically:
1. Install dependencies
2. Run `npm run build` in `client/`
3. Run `npx cap sync android`
4. Run `./gradlew assembleDebug`
5. Stamp build number (`YYYYMMDD.HHMM.SHA`) into the APK versionName
6. Upload artifact to GitHub Actions
7. Publish to GitHub Release tagged `latest-apk`
8. SCP APK to `https://route.aceddivision.com/download/acedroute.apk` (requires `NAMECHEAP_SSH_KEY` repo secret to be set)
9. If `server/` files changed: SSH pull + `touch tmp/restart.txt` to restart the Node app

### Build number format
`YYYYMMDD.HHMM.SHORT_SHA` — example: `20260915.0741.900fb7b`

Visible in: APK version name (Settings → Apps → ACED Route), in-app HUD (if wired), GitHub Releases page.

### Checking CI status
```
https://github.com/ejerenwaavis/ACED-Route/actions
```

---

## Step 3 — Side-load APK to Phone (CrossDevice / Phone Link)

After CI completes, download the APK artifact from GitHub Actions or from the release URL, then copy to the Phone Link watched folder:

```powershell
# Download from GitHub Release (latest)
$apkUrl = "https://github.com/ejerenwaavis/ACED-Route/releases/download/latest-apk/acedroute.apk"
$dest    = "C:\Users\ejere\CrossDevice\OnePlus 8T+ 5G\storage\Download\acedroute.apk"
Invoke-WebRequest -Uri $apkUrl -OutFile $dest
Write-Host "APK copied to phone Downloads folder"
```

The file appears in the phone's Downloads. Tap to install (allow unknown sources if prompted).

### Confirm correct build installed
Check `versionName` via **Settings → Apps → ACED Route → Advanced** on Android, or look at the in-app build indicator. It should match the CI build number shown in the GitHub Actions run summary.

---

## Step 4 — Manual Server Deploy (when CI SSH secret is not set)

> **Note:** The GitHub secret `NAMECHEAP_SSH_KEY` (or `SSH_PRIVATE_KEY`) must be set in the GitHub repo for CI to auto-deploy server changes. Until it is, use the steps below manually after pushing.

### SSH config (already in `~/.ssh/config`):
```
Host aceddivision acedzagz
    HostName 198.54.115.163
    User acedzagz
    Port 21098
    IdentityFile ~/.ssh/id_rsa_acedzagz
```

### Pull and restart server:
```powershell
ssh aceddivision "cd /home/acedzagz/acedroute && git pull origin main && mkdir -p tmp && touch tmp/restart.txt && echo 'Server restarted'"
```

### Deploy web assets (if needed separately):
Web assets are inside the repo — a `git pull` is all that's needed. The Node server serves `public_html/` directly (the Vite build output committed to the repo or built on the server).

### Verify server is live:
```powershell
curl -sI https://route.aceddivision.com/ | head -5
curl -s https://route.aceddivision.com/download/acedroute.apk -o NUL -w "%{http_code} %{size_download} bytes"
```

---

## Quick Reference: Full Deploy Sequence

| Step | What | How |
|------|------|-----|
| 1 | Build Vite | `cd client && npm run build` |
| 2 | Commit & push | `git add -A && git commit -m "..." && git push origin main` |
| 3 | CI builds APK | Automatic — check GitHub Actions |
| 4 | CI publishes APK | Automatic → `latest-apk` release + `route.aceddivision.com/download/acedroute.apk` |
| 5 | CI deploys server | Automatic (if `NAMECHEAP_SSH_KEY` set and `server/` changed) |
| 5a | Manual server deploy | `ssh aceddivision "cd /home/acedzagz/acedroute && git pull origin main && touch tmp/restart.txt"` |
| 6 | Side-load APK | Download from GitHub Release → copy to CrossDevice phone folder |

---

## Setting Up the CI SSH Secret (one-time, to fully automate deploy)

1. Copy your Namecheap private key: `cat ~/.ssh/id_rsa_acedzagz | clip`
2. Go to: `https://github.com/ejerenwaavis/ACED-Route/settings/secrets/actions`
3. Add secret: `NAMECHEAP_SSH_KEY` = (paste the key)
4. From then on, every push to `main` or `pin-fix` will automatically:
   - Deploy APK to `route.aceddivision.com/download/acedroute.apk`
   - Pull + restart server if `server/` changed

---

## Branch Strategy

| Branch | Purpose | APK Built | Server Deploy |
|--------|----------|-----------|---------------|
| `main` | Production | ✅ | ✅ (if server changed) |
| `pin-fix` | Hotfixes / dev | ✅ | ✅ (if server changed) |

Both branches build APK and publish to the `latest-apk` release. Always merge `pin-fix` into `main` when stable.

---

## Troubleshooting

### CI build failed
1. Check `https://github.com/ejerenwaavis/ACED-Route/actions` for the error
2. "What went wrong" is printed by the "Print Gradle Log on Failure" step
3. Common causes: Java/Gradle version mismatch, missing `acedroute.jks.base64`, broken `npm run build`

### Server not serving latest changes
1. Confirm `git pull` ran: `ssh aceddivision "cd /home/acedzagz/acedroute && git log --oneline -3"`
2. Confirm restart.txt was touched: `ssh aceddivision "ls -la /home/acedzagz/acedroute/tmp/"`
3. If using PM2 instead of Passenger: `ssh aceddivision "pm2 restart aced-route"`

### Wrong APK installed on phone
- In-app build number in HUD (if shown) or via Android Settings → Apps → ACED Route
- CI build number format: `YYYYMMDD.HHMM.SHA` — compare to the GitHub Actions run timestamp
