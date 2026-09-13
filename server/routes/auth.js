const express = require('express');
const jwt = require('jsonwebtoken');
const passport = require('passport');

const router = express.Router();

// Step 1: Capacitor app opens the system browser to this URL.
router.get(
  '/google',
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })
);

// Step 2: Google redirects here after the user approves.
// Handles both web browser access and native mobile app (Capacitor) deep linking.
router.get('/googleLoggedIn', (req, res, next) => {
  passport.authenticate('google', { session: false }, (err, user, info) => {
    if (err) {
      console.error('[Google OAuth Error]:', err.message || err);
      // Clean, user-friendly recovery page for expired or already-used auth codes
      return res.status(200).send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ACED Route - Sign In Notice</title>
  <style>
    body {
      background: #0f172a;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 1.5rem;
      text-align: center;
      box-sizing: border-box;
    }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 2rem 1.5rem;
      max-width: 420px;
      width: 100%;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
    }
    h2 { margin-top: 0; color: #38bdf8; font-size: 1.25rem; }
    p { color: #94a3b8; font-size: 0.9rem; line-height: 1.5; margin: 1rem 0 1.5rem; }
    .btn {
      display: inline-block;
      padding: 0.75rem 1.5rem;
      background: #0284c7;
      color: #ffffff;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.95rem;
    }
  </style>
</head>
<body>
  <div class="card">
    <h2>Sign-In Session Expired</h2>
    <p>This authorization code was already redeemed or timed out during verification. Please return to ACED Route to continue.</p>
    <a href="/" class="btn">Return to ACED Route</a>
  </div>
</body>
</html>
      `);
    }

    if (!user) {
      return res.redirect('/api/auth/failure');
    }

    const token = jwt.sign(
      {
        sub: user._id,
        email: user.email,
        name: user.name || (user.email ? user.email.split('@')[0] : 'Driver'),
        role: user.role || 'driver'
      },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    const scheme = process.env.MOBILE_APP_SCHEME || 'acedroute';
    const deepLink = `${scheme}://auth-callback?token=${token}`;
    const displayName = user.name || user.email || 'Driver';

    // HTML Bridge: stores token in localStorage, redirects web browsers to /?token=...,
    // and launches acedroute:// deep link for native Capacitor app.
    res.status(200).send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ACED Route - Signing In...</title>
  <style>
    body {
      background: #0f172a;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 1.5rem;
      text-align: center;
      box-sizing: border-box;
    }
    .spinner {
      width: 44px;
      height: 44px;
      border: 4px solid #334155;
      border-top-color: #38bdf8;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-bottom: 1.25rem;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    h2 { margin: 0 0 0.5rem; color: #f8fafc; font-size: 1.2rem; font-weight: 600; }
    p { margin: 0; color: #94a3b8; font-size: 0.9rem; }
    .btn {
      display: inline-block;
      margin-top: 1.5rem;
      padding: 0.65rem 1.25rem;
      background: #0284c7;
      color: #ffffff;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.85rem;
    }
  </style>
</head>
<body>
  <div class="spinner"></div>
  <h2>Welcome, ${displayName.replace(/</g, '&lt;')}!</h2>
  <p>Signing you in to ACED Route...</p>
  <a id="appBtn" class="btn" style="display:none;" href="${deepLink}">Open Mobile App</a>

  <script>
    const token = ${JSON.stringify(token)};
    const deepLink = ${JSON.stringify(deepLink)};
    const webTarget = "/?token=" + encodeURIComponent(token);

    // Save token to localStorage for browser session
    try {
      localStorage.setItem('aced_jwt', token);
    } catch (e) {}

    const isNativeCandidate = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (isNativeCandidate) {
      // Try opening the native app via deep link
      try {
        window.location.href = deepLink;
      } catch (e) {}

      // Show fallback button if user prefers app
      const btn = document.getElementById('appBtn');
      if (btn) btn.style.display = 'inline-block';

      // If still in the browser after a brief delay, navigate into web app
      setTimeout(function() {
        window.location.replace(webTarget);
      }, 1200);
    } else {
      // Desktop / standard browser
      window.location.replace(webTarget);
    }
  </script>
</body>
</html>
    `);
  })(req, res, next);
});

router.get('/failure', (req, res) => {
  res.status(401).send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ACED Route - Sign In Failed</title>
  <style>
    body { background: #0f172a; color: #f8fafc; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 1.5rem; text-align: center; }
    .card { background: #1e293b; border: 1px solid #ef4444; border-radius: 12px; padding: 2rem 1.5rem; max-width: 400px; }
    h2 { color: #f87171; margin-top: 0; }
    p { color: #94a3b8; font-size: 0.9rem; }
    .btn { display: inline-block; margin-top: 1.5rem; padding: 0.75rem 1.5rem; background: #0284c7; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Google Sign-In Failed</h2>
    <p>We could not complete Google authentication. Please try again.</p>
    <a href="/" class="btn">Try Again</a>
  </div>
</body>
</html>
  `);
});

module.exports = router;
