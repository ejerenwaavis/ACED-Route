const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');

// NOTE: callbackURL must match EXACTLY what you registered in Google Cloud
// Console — you configured "/api/auth/googleLoggedIn", so that's what's here.
// Configure Google Strategy if clientID is available, or load placeholder to prevent startup crash
const clientID = process.env.GOOGLE_CLIENT_ID || 'placeholder_client_id';
const clientSecret = process.env.GOOGLE_CLIENT_SECRET || 'placeholder_client_secret';
const callbackURL = process.env.GOOGLE_CALLBACK_URL || 'https://route.aceddivision.com/api/auth/googleLoggedIn';

passport.use(
  new GoogleStrategy(
    {
      clientID,
      clientSecret,
      callbackURL
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        let user = await User.findOne({ googleId: profile.id });
        if (!user) {
          user = await User.create({
            googleId: profile.id,
            email: profile.emails && profile.emails[0] ? profile.emails[0].value : undefined,
            name: profile.displayName,
            photoUrl: profile.photos && profile.photos[0] ? profile.photos[0].value : undefined
          });
        }
        return done(null, user);
      } catch (err) {
        return done(err, null);
      }
    }
  )
);

// We don't use sessions (mobile app wants a JWT, not a cookie), but Passport
// requires these to exist if you ever call req.login(); harmless no-ops.
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => User.findById(id).then((u) => done(null, u)).catch(done));

module.exports = passport;
