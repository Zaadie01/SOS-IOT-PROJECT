const crypto = require('crypto');
const db     = require('../db');

const ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Generates an 8-character human-friendly code.
 * Uses an alphabet without 0/O/1/I to avoid confusion when read aloud.
 */
function generateRegistrationCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from(crypto.randomBytes(8))
        .map(byte => alphabet[byte % alphabet.length])
        .join('');
}

/**
 * Derives a device's connectivity status from its stored fields.
 * No extra DB round-trip — the fields are already present on the row.
 */
function computeDeviceStatus(device) {
    if (!device.token)        return 'pending';
    if (device.warning)       return 'warning';
    if (!device.last_seen_at) return 'offline';
    const ageMs = Date.now() - device.last_seen_at;
    return ageMs < ONLINE_THRESHOLD_MS ? 'online' : 'offline';
}

// ── Handlers ──────────────────────────────────────────────────────────────────

function listDevices(req, res) {
    const rows = db.prepare(`
        SELECT g.id, g.name, g.registration_code, g.reg_code_expires_at,
               g.registered_at, g.last_seen_at, g.warning, g.token,
               COUNT(se.id) AS sos_count
        FROM   gateways g
        LEFT JOIN sos_events se ON se.device_db_id = g.id
        WHERE  g.owner_id = ?
        GROUP  BY g.id
        ORDER  BY g.registered_at DESC
    `).all(req.user.id);

    const devices = rows.map(row => ({
        id:                  row.id,
        name:                row.name,
        registration_code:   row.registration_code,
        reg_code_expires_at: row.reg_code_expires_at,
        registered_at:       row.registered_at,
        last_seen_at:        row.last_seen_at,
        warning:             row.warning,
        sos_count:           row.sos_count || 0,
        status:              computeDeviceStatus(row),
    }));

    res.json({ devices });
}

function createDevice(req, res) {
    const name      = req.body.name.trim();
    const code      = generateRegistrationCode();
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 h

    const { lastInsertRowid } = db.prepare(`
        INSERT INTO gateways (owner_id, name, registration_code, reg_code_expires_at, registered_at)
        VALUES (?, ?, ?, ?, ?)
    `).run(req.user.id, name, code, expiresAt, Date.now());

    res.status(201).json({
        id:                lastInsertRowid,
        name,
        registration_code: code,
        expires_at:        expiresAt,
    });
}

function renameDevice(req, res) {
    const name   = req.body.name.trim();
    const device = db.prepare('SELECT id FROM gateways WHERE id = ? AND owner_id = ?')
                     .get(req.params.id, req.user.id);

    if (!device) return res.status(404).json({ error: 'Device not found' });

    db.prepare('UPDATE gateways SET name = ? WHERE id = ?').run(name, device.id);
    res.json({ ok: true, name });
}

function deleteDevice(req, res) {
    const device = db.prepare('SELECT id FROM gateways WHERE id = ? AND owner_id = ?')
                     .get(req.params.id, req.user.id);

    if (!device) return res.status(404).json({ error: 'Device not found' });

    db.prepare('DELETE FROM sos_events WHERE device_db_id = ?').run(device.id);
    db.prepare('DELETE FROM gateways   WHERE id = ?').run(device.id);
    res.json({ ok: true });
}

module.exports = { listDevices, createDevice, renameDevice, deleteDevice };
