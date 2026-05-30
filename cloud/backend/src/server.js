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
    // Rename role 'viewer' → 'user'
    try { database.exec(`UPDATE users SET role = 'user' WHERE role = 'viewer'`); } catch (_) {}

    migrateGatewaysTable(database);

    // sos_events — device_db_id is the FK to gateways.id
    database.exec(`
        CREATE TABLE IF NOT EXISTS sos_events (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp      INTEGER NOT NULL,
            button_pressed INTEGER,
            device_db_id   INTEGER,
            synced_at      INTEGER
        )
    `);
    try { database.exec(`ALTER TABLE sos_events ADD COLUMN device_db_id INTEGER`); } catch (_) {}

    // Backfill device_db_id for old events that used gateway_id string
    try {
        database.exec(`
            UPDATE sos_events
            SET device_db_id = (
                SELECT g.id FROM gateways g WHERE g.gateway_id = sos_events.gateway_id
            )
            WHERE device_db_id IS NULL AND gateway_id IS NOT NULL
        `);
    } catch (_) {}

}

function migrateGatewaysTable(database) {
    const cols = database.prepare('PRAGMA table_info(gateways)').all().map(c => c.name);

    if (cols.length === 0) {
        database.exec(`
            CREATE TABLE gateways (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
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

    // Already clean schema
    if (!cols.includes('gateway_id')) return;

    // Migrate: remove gateway_id and device_id columns
    console.log('[MIGRATION] Upgrading gateways table to v3 (removing gateway_id/device_id)...');
    database.exec(`
        CREATE TABLE gateways_v3 (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            name                TEXT,
            owner_id            INTEGER,
            token               TEXT UNIQUE,
            registration_code   TEXT UNIQUE,
            reg_code_expires_at INTEGER,
            registered_at       INTEGER NOT NULL DEFAULT 0,
            last_seen_at        INTEGER,
            warning             TEXT
        );
        INSERT INTO gateways_v3 (id, name, owner_id, token, registration_code, reg_code_expires_at, registered_at, last_seen_at, warning)
            SELECT id, name, owner_id, token, registration_code, reg_code_expires_at, registered_at, last_seen_at, warning
            FROM gateways;
        DROP TABLE gateways;
        ALTER TABLE gateways_v3 RENAME TO gateways;
    `);
    console.log('[MIGRATION] gateways v3 done');
}

