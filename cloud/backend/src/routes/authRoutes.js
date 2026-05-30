const express = require('express');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { requireAuth } = require('../middleware/auth');

function signToken(user) {
    return jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET || 'fallback-dev-secret',
        { expiresIn: '8h' }
    );
}

function safeUser(u) {
    return { id: u.id, email: u.email, role: u.role, display_name: u.display_name || null };
}

module.exports = function authRoutes(db) {
    const router = express.Router();

    // ── Register ────────────────────────────────────────────────────────────
    router.post('/register', (req, res) => {
        const { email, password, name } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'email and password are required' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }
        if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
            return res.status(409).json({ error: 'Email already registered' });
        }

        const hash = bcrypt.hashSync(password, 10);
        const result = db.prepare(
            `INSERT INTO users (email, password_hash, role, display_name, created_at)
             VALUES (?, ?, 'user', ?, ?)`
        ).run(email, hash, name || null, Date.now());

        const user = { id: result.lastInsertRowid, email, role: 'user', display_name: name || null };
        res.status(201).json({ token: signToken(user), user: safeUser(user) });
    });

    // ── Login (Passport Local) ───────────────────────────────────────────────
    router.post('/login', (req, res, next) => {
        passport.authenticate('local', { session: false }, (err, user, info) => {
            if (err) return next(err);
            if (!user) return res.status(401).json({ error: info?.message || 'Invalid credentials' });
            res.json({ token: signToken(user), user: safeUser(user) });
        })(req, res, next);
    });

    // ── Current user ─────────────────────────────────────────────────────────
    router.get('/me', requireAuth, (req, res) => {
        res.json({ user: req.user });
    });

    // ── Google OAuth — start ──────────────────────────────────────────────────
    router.get('/google', (req, res, next) => {
        if (!process.env.GOOGLE_CLIENT_ID) {
            return res.status(503).json({ error: 'Google OAuth is not configured on this server' });
        }
        passport.authenticate('google', { scope: ['profile', 'email'], session: true })(req, res, next);
    });

    // ── Google OAuth — callback ───────────────────────────────────────────────
    router.get('/google/callback',
        (req, res, next) => {
            if (!process.env.GOOGLE_CLIENT_ID) {
                return res.redirect('/login?error=google_not_configured');
            }
            passport.authenticate('google', {
                session: true,
                failureRedirect: '/login?error=google_failed',
            })(req, res, next);
        },
        (req, res) => {
            const user = req.user;
            const token = signToken(user);
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            const userParam = encodeURIComponent(JSON.stringify(safeUser(user)));
            res.redirect(`${frontendUrl}/login?token=${token}&user=${userParam}`);
        }
    );

    return router;
};
