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
// This path MUST match what's registered in Google Cloud Console.
router.get(
  '/googleLoggedIn',
  passport.authenticate('google', { session: false, failureRedirect: '/api/auth/failure' }),
  (req, res) => {
    const token = jwt.sign(
      { sub: req.user._id, email: req.user.email, role: req.user.role },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Deep link back into the Capacitor app. The app registers this custom
    // scheme (see mobile/capacitor.config.json) and grabs the token from
    // the URL when the OS hands control back to it.
    const deepLink = `${process.env.MOBILE_APP_SCHEME || 'acedroute'}://auth-callback?token=${token}`;
    res.redirect(deepLink);
  }
);

router.get('/failure', (req, res) => {
  res.status(401).send('Google sign-in failed. Close this and try again in the app.');
});

module.exports = router;
