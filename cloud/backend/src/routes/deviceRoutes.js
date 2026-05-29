const express = require('express');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');

// Human-friendly 8-char code — avoids 0/O/1/I confusion
function generateRegistrationCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.randomBytes(8);
    return Array.from(bytes).map(b => chars[b % chars.length]).join('');
}

module.exports = function deviceRoutes(db) {
    const router = express.Router();
    router.use(requireAuth);

    // List user's own devices
    router.get('/', (req, res) => {
        const devices = db.prepare(`
            SELECT id, gateway_id, device_id, name, registration_code, reg_code_expires_at,
                   registered_at, last_seen_at, warning,
                   CASE WHEN token IS NOT NULL THEN 1 ELSE 0 END AS is_registered
            FROM gateways
            WHERE owner_id = ?
            ORDER BY registered_at DESC
        `).all(req.user.id);
        res.json({ devices });
    });

    // Create device slot — returns a one-time registration code for the firmware
    router.post('/', (req, res) => {
        const { name } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'name is required' });
        }

        const code = generateRegistrationCode();
        const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 h

        const result = db.prepare(`
            INSERT INTO gateways
                (gateway_id, owner_id, name, registration_code, reg_code_expires_at, registered_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(`pending-${code}`, req.user.id, name.trim(), code, expiresAt, Date.now());

        res.status(201).json({
            id: result.lastInsertRowid,
            name: name.trim(),
            registration_code: code,
            expires_at: expiresAt,
        });
    });

    // Rename device
    router.patch('/:id', (req, res) => {
        const { name } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'name is required' });
        }
        const device = db.prepare(
            'SELECT id FROM gateways WHERE id = ? AND owner_id = ?'
        ).get(req.params.id, req.user.id);
        if (!device) return res.status(404).json({ error: 'Device not found' });

        db.prepare('UPDATE gateways SET name = ? WHERE id = ?').run(name.trim(), device.id);
        res.json({ ok: true, name: name.trim() });
    });

    // Delete device (also removes all its SOS events)
    router.delete('/:id', (req, res) => {
        const device = db.prepare(
            'SELECT id, gateway_id FROM gateways WHERE id = ? AND owner_id = ?'
        ).get(req.params.id, req.user.id);
        if (!device) return res.status(404).json({ error: 'Device not found' });

        db.prepare('DELETE FROM sos_events WHERE gateway_id = ?').run(device.gateway_id);
        db.prepare('DELETE FROM gateways WHERE id = ?').run(device.id);
        res.json({ ok: true });
    });

    // Revoke token — device can no longer send data until re-registered
    router.post('/:id/revoke', (req, res) => {
        const device = db.prepare(
            'SELECT id FROM gateways WHERE id = ? AND owner_id = ?'
        ).get(req.params.id, req.user.id);
        if (!device) return res.status(404).json({ error: 'Device not found' });

        db.prepare('UPDATE gateways SET token = NULL WHERE id = ?').run(device.id);
        res.json({ ok: true, message: 'Device token revoked. Device must re-register to reconnect.' });
    });

    // Regenerate registration code (if not yet registered or after revoke)
    router.post('/:id/regen-code', (req, res) => {
        const device = db.prepare(
            'SELECT id, token FROM gateways WHERE id = ? AND owner_id = ?'
        ).get(req.params.id, req.user.id);
        if (!device) return res.status(404).json({ error: 'Device not found' });

        const code = generateRegistrationCode();
        const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

        db.prepare(
            'UPDATE gateways SET registration_code = ?, reg_code_expires_at = ?, token = NULL WHERE id = ?'
        ).run(code, expiresAt, device.id);

        res.json({ registration_code: code, expires_at: expiresAt });
    });

    return router;
};
