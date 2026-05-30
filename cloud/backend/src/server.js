require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const session = require('express-session');
const passport = require('passport');
const Database = require('better-sqlite3');
const { WebSocketServer } = require('ws');
const bcrypt = require('bcryptjs');

const initPassport = require('./auth/passport');
const authRoutes = require('./routes/authRoutes');
const deviceRoutes = require('./routes/deviceRoutes');
const gatewayRoutes = require('./routes/gatewayRoutes');
const alertRoutes = require('./routes/alertRoutes');

// ── Database ──────────────────────────────────────────────────────────────────
const dbDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dbDir, { recursive: true });
const db = new Database(path.join(dbDir, 'gateway_data.db'));
console.log('Connected to SQLite database');
initDatabase(db);

// ── Passport ──────────────────────────────────────────────────────────────────
initPassport(db);

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(morgan('combined'));

// Sessions are only needed for the Google OAuth redirect dance (~10 s lifetime)
app.use(session({
    secret: process.env.SESSION_SECRET || process.env.JWT_SECRET || 'dev-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 15 * 60 * 1000 },
}));

app.use(passport.initialize());
app.use(passport.session());

// ── WebSocket ─────────────────────────────────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', ws => {
    console.log('[WS] Client connected, total:', wss.clients.size);
    ws.on('close', () => console.log('[WS] Client disconnected, total:', wss.clients.size));
});

function broadcast(data) {
    const msg = JSON.stringify(data);
    wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

// ── Cleanup expired unactivated device slots ──────────────────────────────────
function cleanupExpiredDevices() {
    const { changes } = db.prepare(`
        DELETE FROM gateways
        WHERE registration_code IS NOT NULL
          AND reg_code_expires_at < ?
          AND token IS NULL
    `).run(Date.now());
    if (changes > 0) console.log(`[CLEANUP] Deleted ${changes} expired unactivated device(s)`);
}

cleanupExpiredDevices();
setInterval(cleanupExpiredDevices, 60 * 60 * 1000); // every hour

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => res.json({
    status: 'OK',
    message: 'SOS Gateway Backend API',
    timestamp: new Date().toISOString(),
    ws_clients: wss.clients.size,
}));

app.use('/api/auth', authRoutes(db));
app.use('/api/devices', deviceRoutes(db));
app.use('/api', gatewayRoutes(db, broadcast));   // /api/gateway/* and /api/gateways
app.use('/api/alerts', alertRoutes(db));

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`🔌 WebSocket on ws://localhost:${PORT}/ws`);
});

process.on('SIGINT', () => {
    wss.close();
    db.close();
    console.log('Database connection closed.');
    process.exit(0);
});

// ── Database init + migrations ────────────────────────────────────────────────
function initDatabase(database) {
    database.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            email         TEXT UNIQUE,
            password_hash TEXT NOT NULL DEFAULT '',
            role          TEXT NOT NULL DEFAULT 'viewer',
            display_name  TEXT,
            google_id     TEXT UNIQUE,
            created_at    INTEGER NOT NULL
        )
    `);
    // Migrations for existing installs
    try { database.exec(`ALTER TABLE users ADD COLUMN display_name TEXT`); } catch (_) {}
    try { database.exec(`ALTER TABLE users ADD COLUMN google_id TEXT`); } catch (_) {}

    // Gateways — check if schema needs upgrading (token was NOT NULL in old version)
    migrateGatewaysTable(database);

    database.exec(`
        CREATE TABLE IF NOT EXISTS sos_events (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp      INTEGER NOT NULL,
            device_id      TEXT NOT NULL,
            button_pressed INTEGER,
            gateway_id     TEXT,
            synced_at      INTEGER
        )
    `);

    database.exec(`
        CREATE TABLE IF NOT EXISTS invites (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            token      TEXT UNIQUE NOT NULL,
            created_by INTEGER NOT NULL,
            email      TEXT,
            expires_at INTEGER NOT NULL,
            used_at    INTEGER,
            used_by    INTEGER
        )
    `);

    seedAdminUser(database);
}

function migrateGatewaysTable(database) {
    const cols = database.prepare('PRAGMA table_info(gateways)').all();

    if (cols.length === 0) {
        // Fresh install — create with the correct schema right away
        database.exec(`
            CREATE TABLE gateways (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                gateway_id          TEXT UNIQUE,
                device_id           TEXT,
                name                TEXT,
                owner_id            INTEGER,
                token               TEXT UNIQUE,
                registration_code   TEXT UNIQUE,
                reg_code_expires_at INTEGER,
                registered_at       INTEGER NOT NULL DEFAULT 0,
                last_seen_at        INTEGER,
                warning             TEXT
            )
        `);
        return;
    }

    const hasOwner = cols.some(c => c.name === 'owner_id');
    const tokenNotNull = cols.find(c => c.name === 'token')?.notnull === 1;

    if (hasOwner && !tokenNotNull) return; // already up to date

    console.log('[MIGRATION] Upgrading gateways table...');
    database.exec(`
        CREATE TABLE gateways_v2 (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            gateway_id          TEXT UNIQUE,
            device_id           TEXT,
            name                TEXT,
            owner_id            INTEGER,
            token               TEXT UNIQUE,
            registration_code   TEXT UNIQUE,
            reg_code_expires_at INTEGER,
            registered_at       INTEGER NOT NULL DEFAULT 0,
            last_seen_at        INTEGER,
            warning             TEXT
        );
        INSERT INTO gateways_v2 (id, gateway_id, device_id, token, registered_at, last_seen_at, warning)
            SELECT id, gateway_id, device_id, token, registered_at, last_seen_at, warning
            FROM gateways;
        DROP TABLE gateways;
        ALTER TABLE gateways_v2 RENAME TO gateways;
    `);
    console.log('[MIGRATION] gateways table upgraded');
}

function seedAdminUser(database) {
    const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
        console.warn('[SEED] ADMIN_EMAIL or ADMIN_PASSWORD not set — skipping admin seed');
        return;
    }
    if (database.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL)) return;
    database.prepare(
        `INSERT INTO users (email, password_hash, role, created_at) VALUES (?, ?, 'admin', ?)`
    ).run(ADMIN_EMAIL, bcrypt.hashSync(ADMIN_PASSWORD, 10), Date.now());
    console.log(`[SEED] Admin user created: ${ADMIN_EMAIL}`);
}
