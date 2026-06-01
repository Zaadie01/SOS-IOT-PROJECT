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
    const userId = req.user.id;

    const rows = db.prepare(`
        SELECT g.id, g.name, g.registration_code, g.reg_code_expires_at,
               g.registered_at, g.last_seen_at, g.warning, g.token,
               g.owner_id,
               COALESCE(u.display_name, u.email) AS owner_name,
               COUNT(se.id) AS sos_count,
               CASE WHEN g.owner_id = ? THEN 1 ELSE 0 END AS is_owner
        FROM   gateways g
        LEFT JOIN sos_events se ON se.device_db_id = g.id
        LEFT JOIN users u ON u.id = g.owner_id
        WHERE  g.owner_id = ?
           OR  g.id IN (
               SELECT device_id FROM device_invitations
               WHERE invitee_id = ? AND status = 'accepted'
           )
        GROUP  BY g.id
        ORDER  BY g.registered_at DESC
    `).all(userId, userId, userId);

    const devices = rows.map(row => ({
        id:                  row.id,
        name:                row.name,
        registration_code:   row.is_owner ? row.registration_code   : null,
        reg_code_expires_at: row.is_owner ? row.reg_code_expires_at : null,
        registered_at:       row.registered_at,
        last_seen_at:        row.last_seen_at,
        warning:             row.warning,
        sos_count:           row.sos_count || 0,
        status:              computeDeviceStatus(row),
        is_owner:            Boolean(row.is_owner),
        owner_id:            row.owner_id,
        owner_name:          row.owner_name,
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

    db.prepare('DELETE FROM sos_events          WHERE device_db_id = ?').run(device.id);
    db.prepare('DELETE FROM device_invitations  WHERE device_id    = ?').run(device.id);
    db.prepare('DELETE FROM notification_prefs  WHERE device_id    = ?').run(device.id);
    db.prepare('DELETE FROM gateways            WHERE id           = ?').run(device.id);
    res.json({ ok: true });
}

module.exports = { listDevices, createDevice, renameDevice, deleteDevice };
