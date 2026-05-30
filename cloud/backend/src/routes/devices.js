const router = require('express').Router();
const crypto = require('crypto');
const db     = require('../db');
const { requireAuth } = require('../middleware/auth');

const ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

function generateRegistrationCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
    return Array.from(crypto.randomBytes(8))
        .map(b => chars[b % chars.length])
        .join('');
}

function computeStatus(device) {
    if (!device.token)         return 'pending';
    if (device.warning)        return 'warning';
    if (!device.last_seen_at)  return 'offline';
    return (Date.now() - device.last_seen_at) < ONLINE_THRESHOLD_MS ? 'online' : 'offline';
}

router.use(requireAuth);

// List user's devices
router.get('/', (req, res) => {
    const rows = db.prepare(`
        SELECT id, name, registration_code, reg_code_expires_at,
               registered_at, last_seen_at, warning, token
        FROM gateways
        WHERE owner_id = ?
        ORDER BY registered_at DESC
    `).all(req.user.id);

    const devices = rows.map(d => ({
        id:                  d.id,
        name:                d.name,
        registration_code:   d.registration_code,
        reg_code_expires_at: d.reg_code_expires_at,
        registered_at:       d.registered_at,
        last_seen_at:        d.last_seen_at,
        warning:             d.warning,
        status:              computeStatus(d),
    }));

    res.json({ devices });
});

// Create a device slot — returns a one-time registration code for the firmware
router.post('/', (req, res) => {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

    const code      = generateRegistrationCode();
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 h

    const { lastInsertRowid } = db.prepare(`
        INSERT INTO gateways (owner_id, name, registration_code, reg_code_expires_at, registered_at)
        VALUES (?, ?, ?, ?, ?)
    `).run(req.user.id, name.trim(), code, expiresAt, Date.now());

    res.status(201).json({
        id:                lastInsertRowid,
        name:              name.trim(),
        registration_code: code,
        expires_at:        expiresAt,
    });
});

// Rename a device
router.patch('/:id', (req, res) => {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

    const device = db.prepare('SELECT id FROM gateways WHERE id = ? AND owner_id = ?')
                     .get(req.params.id, req.user.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    db.prepare('UPDATE gateways SET name = ? WHERE id = ?').run(name.trim(), device.id);
    res.json({ ok: true, name: name.trim() });
});

// Delete a device and all its SOS history
router.delete('/:id', (req, res) => {
    const device = db.prepare('SELECT id FROM gateways WHERE id = ? AND owner_id = ?')
                     .get(req.params.id, req.user.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    db.prepare('DELETE FROM sos_events WHERE device_db_id = ?').run(device.id);
    db.prepare('DELETE FROM gateways   WHERE id = ?').run(device.id);
    res.json({ ok: true });
});

module.exports = router;
