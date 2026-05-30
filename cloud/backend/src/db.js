const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'gateway_data.db'));

// ── Schema & migrations ───────────────────────────────────────────────────────

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        email         TEXT UNIQUE,
        password_hash TEXT NOT NULL DEFAULT '',
        role          TEXT NOT NULL DEFAULT 'user',
        display_name  TEXT,
        google_id     TEXT UNIQUE,
        created_at    INTEGER NOT NULL
    )
`);
try { db.exec(`ALTER TABLE users ADD COLUMN display_name TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE users ADD COLUMN google_id TEXT`);    } catch (_) {}
try { db.exec(`UPDATE users SET role = 'user' WHERE role = 'viewer'`); } catch (_) {}

// Gateways — v3 schema removes gateway_id / device_id
const gatewayCols = db.prepare('PRAGMA table_info(gateways)').all().map(c => c.name);

if (gatewayCols.length === 0) {
    db.exec(`
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
} else if (gatewayCols.includes('gateway_id')) {
    console.log('[db] Migrating gateways table to v3...');
    db.exec(`
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
        INSERT INTO gateways_v3 (id, name, owner_id, token, registration_code,
                                  reg_code_expires_at, registered_at, last_seen_at, warning)
            SELECT id, name, owner_id, token, registration_code,
                   reg_code_expires_at, registered_at, last_seen_at, warning
            FROM gateways;
        DROP TABLE gateways;
        ALTER TABLE gateways_v3 RENAME TO gateways;
    `);
}

// SOS events — v2 schema uses device_db_id (integer FK) instead of string columns
const sosCols = db.prepare('PRAGMA table_info(sos_events)').all();

if (sosCols.length === 0) {
    db.exec(`
        CREATE TABLE sos_events (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp      INTEGER NOT NULL,
            button_pressed INTEGER,
            device_db_id   INTEGER,
            synced_at      INTEGER
        )
    `);
} else {
    const hasDeviceDbId = sosCols.some(c => c.name === 'device_db_id');
    const hasNotNull    = sosCols.some(c => (c.name === 'device_id' || c.name === 'gateway_id') && c.notnull === 1);

    if (!hasDeviceDbId) {
        try { db.exec(`ALTER TABLE sos_events ADD COLUMN device_db_id INTEGER`); } catch (_) {}
    }

    if (hasNotNull) {
        console.log('[db] Migrating sos_events table to v2...');
        db.exec(`
            CREATE TABLE sos_events_v2 (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp      INTEGER NOT NULL,
                button_pressed INTEGER,
                device_db_id   INTEGER,
                synced_at      INTEGER
            );
            INSERT INTO sos_events_v2 (id, timestamp, button_pressed, device_db_id, synced_at)
                SELECT id, timestamp, button_pressed, device_db_id, synced_at FROM sos_events;
            DROP TABLE sos_events;
            ALTER TABLE sos_events_v2 RENAME TO sos_events;
        `);
    }
}

// ── Cleanup job — delete device slots whose registration code expired ─────────

function cleanupExpiredDevices() {
    const { changes } = db.prepare(`
        DELETE FROM gateways
        WHERE registration_code IS NOT NULL
          AND reg_code_expires_at < ?
          AND token IS NULL
    `).run(Date.now());

    if (changes > 0) console.log(`[db] Removed ${changes} expired unactivated device(s)`);
}

cleanupExpiredDevices();
setInterval(cleanupExpiredDevices, 60 * 60 * 1000);

module.exports = db;
