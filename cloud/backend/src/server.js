// server.js
require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const Database = require('better-sqlite3');
const path = require('path');
const { WebSocketServer } = require('ws');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { requireAuth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3001;
const REGISTRATION_SECRET = process.env.REGISTRATION_SECRET;
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('combined'));

// Database setup
const dbDir = path.join(__dirname, '..', 'data');
require('fs').mkdirSync(dbDir, { recursive: true });
const dbPath = path.join(dbDir, 'gateway_data.db');
const db = new Database(dbPath);
console.log('Connected to SQLite database');
initDatabase();

function initDatabase() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS gateways (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            gateway_id    TEXT UNIQUE NOT NULL,
            device_id     TEXT,
            token         TEXT UNIQUE NOT NULL,
            registered_at INTEGER NOT NULL,
            last_seen_at  INTEGER,
            warning       TEXT
        )
    `);

    // Migration: add warning column if missing
    try { db.exec(`ALTER TABLE gateways ADD COLUMN warning TEXT`); } catch (_) {}

    db.exec(`
        CREATE TABLE IF NOT EXISTS sos_events (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp      INTEGER NOT NULL,
            device_id      TEXT NOT NULL,
            button_pressed INTEGER,
            gateway_id     TEXT,
            synced_at      INTEGER
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            email         TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role          TEXT NOT NULL DEFAULT 'viewer',
            created_at    INTEGER NOT NULL
        )
    `);

    seedAdminUser();
}

function seedAdminUser() {
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
        console.warn('[SEED] ADMIN_EMAIL or ADMIN_PASSWORD not set — skipping admin seed');
        return;
    }
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL);
    if (existing) {
        console.log('[SEED] Admin user already exists, skipping');
        return;
    }
    const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
    db.prepare('INSERT INTO users (email, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
      .run(ADMIN_EMAIL, hash, 'admin', Date.now());
    console.log(`[SEED] Admin user created: ${ADMIN_EMAIL}`);
}

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
    console.log('[WS] Client connected, total:', wss.clients.size);
    ws.on('close', () => console.log('[WS] Client disconnected, total:', wss.clients.size));
});

function broadcast(data) {
    const msg = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === 1) client.send(msg);
    });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Health check
app.get('/', (_req, res) => {
    res.json({
        status: 'OK',
        message: 'SOS Gateway Backend API',
        timestamp: new Date().toISOString(),
        ws_clients: wss.clients.size,
    });
});

// Login — returns JWT
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'email and password are required' });
    }
    if (!JWT_SECRET) {
        return res.status(500).json({ error: 'Server misconfiguration' });
    }
    try {
        const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
        if (!user || !bcrypt.compareSync(password, user.password_hash)) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            JWT_SECRET,
            { expiresIn: '8h' }
        );
        res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
    } catch (err) {
        console.error('[LOGIN] Error:', err);
        res.status(500).json({ error: 'Internal error' });
    }
});

// Current user info
app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
});

// Register a new gateway and receive a unique token
app.post('/api/gateway/register', (req, res) => {
    if (!REGISTRATION_SECRET) {
        return res.status(503).json({ error: 'Registration not configured on server' });
    }
    const { gateway_id, device_id, secret } = req.body;
    if (!gateway_id || !secret) {
        return res.status(400).json({ error: 'gateway_id and secret are required' });
    }
    if (secret !== REGISTRATION_SECRET) {
        console.warn(`[REGISTER] Bad secret from gateway_id=${gateway_id}`);
        return res.status(401).json({ error: 'Invalid registration secret' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    try {
        db.prepare(
            `INSERT OR REPLACE INTO gateways (gateway_id, device_id, token, registered_at) VALUES (?, ?, ?, ?)`
        ).run(gateway_id, device_id || null, token, Date.now());
        console.log(`[REGISTER] Gateway registered: id=${gateway_id} device=${device_id}`);
        res.status(201).json({ token });
    } catch (err) {
        console.error('[REGISTER] DB error:', err);
        res.status(500).json({ error: 'Failed to register gateway' });
    }
});

// Receive SOS event from Gateway
app.post('/api/gateway/data', (req, res) => {
    const incomingToken = req.headers['x-gateway-token'];
    if (!incomingToken) return res.status(401).json({ error: 'Unauthorized — gateway not registered' });

    try {
        const gateway = db.prepare('SELECT * FROM gateways WHERE token = ?').get(incomingToken);
        if (!gateway) return res.status(401).json({ error: 'Unauthorized — gateway not registered' });

        db.prepare('UPDATE gateways SET last_seen_at = ? WHERE id = ?').run(Date.now(), gateway.id);

        const { timestamp, device_id, button_pressed, gateway_id, sos_alert } = req.body;
        if (!sos_alert) return res.status(200).json({ success: true, message: 'Non-SOS data ignored' });

        const result = db.prepare(
            `INSERT INTO sos_events (timestamp, device_id, button_pressed, gateway_id, synced_at) VALUES (?, ?, ?, ?, ?)`
        ).run(timestamp, device_id, button_pressed, gateway_id, Date.now());

        const event = { id: result.lastInsertRowid, timestamp, device_id, button_pressed, gateway_id };
        console.log('🚨 SOS ALERT from device:', device_id, '— clicks:', button_pressed);
        broadcast({ type: 'sos', event });
        res.status(201).json({ success: true, id: result.lastInsertRowid });
    } catch (err) {
        console.error('[DATA] DB error:', err);
        res.status(500).json({ error: 'Failed to store data' });
    }
});

// Heartbeat — gateway confirms it is alive
app.post('/api/gateway/ping', (req, res) => {
    const incomingToken = req.headers['x-gateway-token'];
    if (!incomingToken) return res.status(401).json({ error: 'Unauthorized — gateway not registered' });
    try {
        const gateway = db.prepare('SELECT * FROM gateways WHERE token = ?').get(incomingToken);
        if (!gateway) return res.status(401).json({ error: 'Unauthorized — gateway not registered' });
        db.prepare('UPDATE gateways SET last_seen_at = ? WHERE id = ?').run(Date.now(), gateway.id);
        console.log(`[PING] Heartbeat from gateway: ${gateway.gateway_id}`);
        res.json({ ok: true, server_time: Date.now() });
    } catch (err) {
        console.error('[PING] DB error:', err);
        res.status(500).json({ error: 'Internal error' });
    }
});

// Warning — gateway reports a problem (message) or clears it (message: null)
app.post('/api/gateway/warning', (req, res) => {
    const incomingToken = req.headers['x-gateway-token'];
    if (!incomingToken) return res.status(401).json({ error: 'Unauthorized — gateway not registered' });
    try {
        const gateway = db.prepare('SELECT * FROM gateways WHERE token = ?').get(incomingToken);
        if (!gateway) return res.status(401).json({ error: 'Unauthorized — gateway not registered' });
        const warning = req.body.message || null;
        db.prepare('UPDATE gateways SET last_seen_at = ?, warning = ? WHERE id = ?')
          .run(Date.now(), warning, gateway.id);
        if (warning) console.warn(`[WARNING] Gateway ${gateway.gateway_id}: ${warning}`);
        else console.log(`[WARNING] Gateway ${gateway.gateway_id}: warning cleared`);
        res.json({ ok: true });
    } catch (err) {
        console.error('[WARNING] DB error:', err);
        res.status(500).json({ error: 'Internal error' });
    }
});

// Get SOS history
app.get('/api/alerts/sos', requireAuth, (req, res) => {
    try {
        const rows = db.prepare(`SELECT * FROM sos_events ORDER BY timestamp DESC`).all();
        res.json({ alerts: rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get registered gateways
app.get('/api/gateways', requireAuth, (req, res) => {
    try {
        const rows = db.prepare(
            `SELECT gateway_id, device_id, registered_at, last_seen_at, warning FROM gateways ORDER BY registered_at DESC`
        ).all();
        res.json({ gateways: rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get single gateway status by ID
app.get('/api/gateways/:gateway_id', requireAuth, (req, res) => {
    try {
        const row = db.prepare(
            `SELECT gateway_id, device_id, registered_at, last_seen_at, warning FROM gateways WHERE gateway_id = ?`
        ).get(req.params.gateway_id);
        if (!row) return res.status(404).json({ error: 'Gateway not found' });
        res.json({ gateway: row });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Start
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`🔌 WebSocket on ws://localhost:${PORT}/ws`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    wss.close();
    db.close();
    console.log('Database connection closed.');
    process.exit(0);
});
