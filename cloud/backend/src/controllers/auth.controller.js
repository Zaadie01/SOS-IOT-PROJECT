const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const passport = require('passport');
const db       = require('../db');

const JWT_SECRET   = process.env.JWT_SECRET   || 'fallback-dev-secret';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// ── Helpers ───────────────────────────────────────────────────────────────────

function signToken(user) {
    return jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: '8h' }
    );
}

/** Returns only the fields that are safe to expose in API responses. */
function publicUserFields(user) {
    return {
        id:           user.id,
        email:        user.email,
        role:         user.role,
        display_name: user.display_name || null,
        google_id:    user.google_id    || null,
    };
}

// ── Handlers ──────────────────────────────────────────────────────────────────

function register(req, res) {
    const { email, password, name } = req.body;

    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
        return res.status(409).json({ error: 'Email already registered' });
    }

    const { lastInsertRowid } = db.prepare(`
        INSERT INTO users (email, password_hash, role, display_name, created_at)
        VALUES (?, ?, 'user', ?, ?)
    `).run(email, bcrypt.hashSync(password, 10), name?.trim() || null, Date.now());

    const newUser = { id: lastInsertRowid, email, role: 'user', display_name: name?.trim() || null };
    res.status(201).json({ token: signToken(newUser), user: publicUserFields(newUser) });
}

function login(req, res, next) {
    passport.authenticate('local', { session: false }, (err, user, info) => {
        if (err)   return next(err);
        if (!user) return res.status(401).json({ error: info?.message || 'Invalid credentials' });
        res.json({ token: signToken(user), user: publicUserFields(user) });
    })(req, res, next);
}

function getCurrentUser(req, res) {
    res.json({ user: req.user });
}

function startGoogleOAuth(req, res, next) {
    if (!process.env.GOOGLE_CLIENT_ID) {
        return res.status(503).json({ error: 'Google OAuth is not configured' });
    }
    passport.authenticate('google', { scope: ['profile', 'email'], session: true })(req, res, next);
}

/** Step 1 of account linking — stores the current user id in the session. */
function prepareGoogleLink(req, res) {
    if (!process.env.GOOGLE_CLIENT_ID) {
        return res.status(503).json({ error: 'Google OAuth is not configured' });
    }
    req.session.linkUserId = req.user.id;
    req.session.save(() => res.json({ ok: true }));
}

/** Step 2 of account linking — browser navigates here; session carries linkUserId. */
function startGoogleLink(req, res, next) {
    if (!process.env.GOOGLE_CLIENT_ID) {
        return res.status(503).json({ error: 'Google OAuth is not configured' });
    }
    if (!req.session?.linkUserId) {
        return res.redirect(`${FRONTEND_URL}/devices?error=link_session_expired`);
    }
    passport.authenticate('google', { scope: ['profile', 'email'], session: true })(req, res, next);
}

/** Runs passport Google verification, then falls through to redirectAfterGoogleOAuth. */
function googleOAuthCallback(req, res, next) {
    if (!process.env.GOOGLE_CLIENT_ID) {
        return res.redirect(`${FRONTEND_URL}/login?error=google_not_configured`);
    }
    passport.authenticate('google', {
        session: true,
        failureRedirect: `${FRONTEND_URL}/login?error=google_failed`,
    })(req, res, next);
}

/** Redirects the browser back to the frontend with a fresh JWT. */
function redirectAfterGoogleOAuth(req, res) {
    const token     = signToken(req.user);
    const userParam = encodeURIComponent(JSON.stringify(publicUserFields(req.user)));
    res.redirect(`${FRONTEND_URL}/login?token=${token}&user=${userParam}`);
}

module.exports = {
    register,
    login,
    getCurrentUser,
    startGoogleOAuth,
    prepareGoogleLink,
    startGoogleLink,
    googleOAuthCallback,
    redirectAfterGoogleOAuth,
};
