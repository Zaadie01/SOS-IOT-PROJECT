const router   = require('express').Router();
const passport = require('passport');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const { body } = require('express-validator');
const db       = require('../db');
const { requireAuth } = require('../middleware/auth');
const { validate }    = require('../middleware/validate');

const JWT_SECRET   = process.env.JWT_SECRET || 'fallback-dev-secret';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

function signToken(user) {
    return jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: '8h' }
    );
}

function safeUser(u) {
    return {
        id:           u.id,
        email:        u.email,
        role:         u.role,
        display_name: u.display_name || null,
        google_id:    u.google_id    || null,
    };
}

// ── Validation rules ──────────────────────────────────────────────────────────
const registerRules = [
    body('email')
        .isEmail().withMessage('Invalid email address')
        .isLength({ max: 254 }).withMessage('Email is too long (max 254)'),
    body('password')
        .isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
        .isLength({ max: 128 }).withMessage('Password is too long (max 128)'),
    body('name')
        .optional({ checkFalsy: true })
        .trim()
        .isLength({ max: 50 }).withMessage('Name is too long (max 50)'),
];

const loginRules = [
    body('email').notEmpty().withMessage('Email is required'),
    body('password').notEmpty().withMessage('Password is required'),
];

// ── Register ──────────────────────────────────────────────────────────────────
router.post('/register', registerRules, validate, (req, res) => {
    const { email, password, name } = req.body;

    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
        return res.status(409).json({ error: 'Email already registered' });
    }

    const result = db.prepare(`
        INSERT INTO users (email, password_hash, role, display_name, created_at)
        VALUES (?, ?, 'user', ?, ?)
    `).run(email, bcrypt.hashSync(password, 10), name?.trim() || null, Date.now());

    const user = { id: result.lastInsertRowid, email, role: 'user', display_name: name?.trim() || null };
    res.status(201).json({ token: signToken(user), user: safeUser(user) });
});

// ── Login (Passport Local) ────────────────────────────────────────────────────
router.post('/login', loginRules, validate, (req, res, next) => {
    passport.authenticate('local', { session: false }, (err, user, info) => {
        if (err)   return next(err);
        if (!user) return res.status(401).json({ error: info?.message || 'Invalid credentials' });
        res.json({ token: signToken(user), user: safeUser(user) });
    })(req, res, next);
});

// ── Current user ──────────────────────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
});

// ── Google OAuth — login / register ──────────────────────────────────────────
router.get('/google', (req, res, next) => {
    if (!process.env.GOOGLE_CLIENT_ID) {
        return res.status(503).json({ error: 'Google OAuth is not configured' });
    }
    passport.authenticate('google', { scope: ['profile', 'email'], session: true })(req, res, next);
});

// Step 1: Store linkUserId in session via authenticated API call
router.post('/google/prepare-link', requireAuth, (req, res) => {
    if (!process.env.GOOGLE_CLIENT_ID) {
        return res.status(503).json({ error: 'Google OAuth is not configured' });
    }
    req.session.linkUserId = req.user.id;
    req.session.save(() => res.json({ ok: true }));
});

// Step 2: Browser navigates here (session cookie carries linkUserId)
router.get('/google/link', (req, res, next) => {
    if (!process.env.GOOGLE_CLIENT_ID) {
        return res.status(503).json({ error: 'Google OAuth is not configured' });
    }
    if (!req.session?.linkUserId) {
        return res.redirect(`${FRONTEND_URL}/devices?error=link_session_expired`);
    }
    passport.authenticate('google', { scope: ['profile', 'email'], session: true })(req, res, next);
});

router.get('/google/callback',
    (req, res, next) => {
        if (!process.env.GOOGLE_CLIENT_ID) {
            return res.redirect(`${FRONTEND_URL}/login?error=google_not_configured`);
        }
        passport.authenticate('google', {
            session: true,
            failureRedirect: `${FRONTEND_URL}/login?error=google_failed`,
        })(req, res, next);
    },
    (req, res) => {
        const token     = signToken(req.user);
        const userParam = encodeURIComponent(JSON.stringify(safeUser(req.user)));
        res.redirect(`${FRONTEND_URL}/login?token=${token}&user=${userParam}`);
    }
);

module.exports = router;
