/**
 * Creates all tables and runs any pending migrations.
 * Called once at startup, before the HTTP server begins accepting requests.
 */
function initSchema(db) {

    // ── Users ──────────────────────────────────────────────────────────────────
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

    // Migrations for older installs
    try { db.exec(`ALTER TABLE users ADD COLUMN display_name TEXT`); } catch (_) {}
    try { db.exec(`ALTER TABLE users ADD COLUMN google_id TEXT`);    } catch (_) {}
    try { db.exec(`UPDATE users SET role = 'user' WHERE role = 'viewer'`); } catch (_) {}

    // ── Gateways (v3 — no gateway_id / device_id columns) ─────────────────────
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
        console.log('[db] Migrating gateways → v3 (dropping gateway_id / device_id)…');
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
            INSERT INTO gateways_v3
                (id, name, owner_id, token, registration_code,
                 reg_code_expires_at, registered_at, last_seen_at, warning)
                SELECT id, name, owner_id, token, registration_code,
                       reg_code_expires_at, registered_at, last_seen_at, warning
                FROM gateways;
            DROP TABLE gateways;
            ALTER TABLE gateways_v3 RENAME TO gateways;
        `);
    }

    // ── Device invitations ────────────────────────────────────────────────────
    db.exec(`
        CREATE TABLE IF NOT EXISTS device_invitations (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id    INTEGER NOT NULL,
            inviter_id   INTEGER NOT NULL,
            invitee_id   INTEGER NOT NULL,
            status       TEXT NOT NULL DEFAULT 'pending',
            created_at   INTEGER,
            responded_at INTEGER,
            UNIQUE(device_id, invitee_id)
        )
    `);

    // ── Notification preferences ───────────────────────────────────────────────
    db.exec(`
        CREATE TABLE IF NOT EXISTS notification_prefs (
            user_id   INTEGER NOT NULL,
            device_id INTEGER NOT NULL,
            enabled   INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, device_id)
        )
    `);

    // ── SOS events (v2 — uses device_db_id integer FK) ─────────────────────────
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
        const hasLegacyNotNull = sosCols.some(
            c => (c.name === 'device_id' || c.name === 'gateway_id') && c.notnull === 1
        );

        if (!hasDeviceDbId) {
            try { db.exec(`ALTER TABLE sos_events ADD COLUMN device_db_id INTEGER`); } catch (_) {}
        }

        if (hasLegacyNotNull) {
            console.log('[db] Migrating sos_events → v2 (integer FK)…');
            db.exec(`
                CREATE TABLE sos_events_v2 (
                    id             INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp      INTEGER NOT NULL,
                    button_pressed INTEGER,
                    device_db_id   INTEGER,
                    synced_at      INTEGER
                );
                INSERT INTO sos_events_v2 (id, timestamp, button_pressed, device_db_id, synced_at)
                    SELECT id, timestamp, button_pressed, device_db_id, synced_at
                    FROM sos_events;
                DROP TABLE sos_events;
                ALTER TABLE sos_events_v2 RENAME TO sos_events;
            `);
        }
    }
}

module.exports = { initSchema };
