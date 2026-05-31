const passport = require('passport');
const { Strategy: LocalStrategy  } = require('passport-local');
const { Strategy: JwtStrategy, ExtractJwt } = require('passport-jwt');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const bcrypt = require('bcryptjs');
const db = require('../db');

// ── Local — email + password ──────────────────────────────────────────────────
passport.use('local', new LocalStrategy(
    { usernameField: 'email', passwordField: 'password' },
    (email, password, done) => {
        try {
            const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
            if (!user || !bcrypt.compareSync(password, user.password_hash)) {
                return done(null, false, { message: 'Invalid credentials' });
            }
            return done(null, user);
        } catch (err) {
            return done(err);
        }
    }
));

// ── JWT — Bearer token on protected routes ────────────────────────────────────
passport.use('jwt', new JwtStrategy(
    {
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
        secretOrKey:    process.env.JWT_SECRET || 'fallback-dev-secret',
    },
    (payload, done) => {
        try {
            const user = db.prepare(
                'SELECT id, email, role, display_name, google_id FROM users WHERE id = ?'
            ).get(payload.id);
            return done(null, user || false);
        } catch (err) {
            return done(err);
        }
    }
));

// ── Google OAuth — only registered when credentials are provided ──────────────
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use('google', new GoogleStrategy(
        {
            clientID:          process.env.GOOGLE_CLIENT_ID,
            clientSecret:      process.env.GOOGLE_CLIENT_SECRET,
            callbackURL:       process.env.GOOGLE_CALLBACK_URL
                               || 'http://localhost:3001/api/auth/google/callback',
            passReqToCallback: true,
        },
        (req, _accessToken, _refreshToken, profile, done) => {
            const email       = profile.emails?.[0]?.value || null;
            const googleId    = profile.id;
            const displayName = profile.displayName || null;

            try {
                // ── Link mode: user is logged in and wants to attach this Google account ──
                if (req.session?.linkUserId) {
                    const userId = req.session.linkUserId;
                    req.session.linkUserId = null;

                    const taken = db.prepare('SELECT id FROM users WHERE google_id = ?').get(googleId);
                    if (taken && taken.id !== userId) {
                        return done(null, false, { message: 'This Google account is already linked to another user' });
                    }

                    db.prepare(
                        'UPDATE users SET google_id = ?, display_name = COALESCE(display_name, ?) WHERE id = ?'
                    ).run(googleId, displayName, userId);

                    const user = db.prepare(
                        'SELECT id, email, role, display_name, google_id FROM users WHERE id = ?'
                    ).get(userId);
                    return done(null, user);
                }

                // ── Normal flow: login or register via Google ─────────────────
                let user = db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId);
                if (user) return done(null, user);

                // Auto-link if the Google email matches an existing account
                if (email) {
                    user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
                    if (user) {
                        db.prepare(
                            'UPDATE users SET google_id = ?, display_name = COALESCE(display_name, ?) WHERE id = ?'
                        ).run(googleId, displayName, user.id);
                        return done(null, { ...user, google_id: googleId });
                    }
                }

                // New account via Google
                const result = db.prepare(`
                    INSERT INTO users (email, password_hash, role, display_name, google_id, created_at)
                    VALUES (?, '', 'user', ?, ?, ?)
                `).run(email, displayName, googleId, Date.now());

                user = db.prepare(
                    'SELECT id, email, role, display_name, google_id FROM users WHERE id = ?'
                ).get(result.lastInsertRowid);
                return done(null, user);
            } catch (err) {
                return done(err);
            }
        }
    ));
}

// ── Session serialization (used only during Google OAuth redirect) ────────────
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
    try {
        const user = db.prepare(
            'SELECT id, email, role, display_name, google_id FROM users WHERE id = ?'
        ).get(id);
        done(null, user || false);
    } catch (err) {
        done(err);
    }
});

module.exports = passport;
