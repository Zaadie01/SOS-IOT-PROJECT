const express = require('express');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');

const ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

function generateRegistrationCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.randomBytes(8);
    return Array.from(bytes).map(b => chars[b % chars.length]).join('');
}

function computeStatus(device) {
    if (!device.token) return 'pending';
    if (device.warning) return 'warning';
    if (!device.last_seen_at) return 'offline';
    return (Date.now() - device.last_seen_at) < ONLINE_THRESHOLD_MS ? 'online' : 'offline';
}

module.exports = function deviceRoutes(db) {
    const router = express.Router();
    router.use(requireAuth);

    // List user's devices with computed status
    router.get('/', (req, res) => {
        const rows = db.prepare(`
            SELECT id, name, registration_code,
                   reg_code_expires_at, registered_at, last_seen_at, warning, token
            FROM gateways
            WHERE owner_id = ?
            ORDER BY registered_at DESC
        `).all(req.user.id);

        const devices = rows.map(d => ({
            id: d.id,
            name: d.name,
            registration_code: d.registration_code,
            reg_code_expires_at: d.reg_code_expires_at,
            registered_at: d.registered_at,
            last_seen_at: d.last_seen_at,
            warning: d.warning,
            status: computeStatus(d),
        }));

        res.json({ devices });
    });

    // Create device slot — returns a one-time registration code for the firmware
    router.post('/', (req, res) => {
        const { name } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'name is required' });
        }

        const code = generateRegistrationCode();
        const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

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

    // Delete device and all its SOS history
    router.delete('/:id', (req, res) => {
        const device = db.prepare(
            'SELECT id, gateway_id FROM gateways WHERE id = ? AND owner_id = ?'
        ).get(req.params.id, req.user.id);
        if (!device) return res.status(404).json({ error: 'Device not found' });

        db.prepare('DELETE FROM sos_events WHERE gateway_id = ?').run(device.gateway_id);
        db.prepare('DELETE FROM gateways WHERE id = ?').run(device.id);
        res.json({ ok: true });
    });

    return router;
};
