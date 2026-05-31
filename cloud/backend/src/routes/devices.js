const router = require('express').Router();
const crypto = require('crypto');
const { body } = require('express-validator');
const db     = require('../db');
const { requireAuth } = require('../middleware/auth');
const { validate }    = require('../middleware/validate');

const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

function generateRegistrationCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from(crypto.randomBytes(8))
        .map(b => chars[b % chars.length])
        .join('');
}

function computeStatus(device) {
    if (!device.token)        return 'pending';
    if (device.warning)       return 'warning';
    if (!device.last_seen_at) return 'offline';
    return (Date.now() - device.last_seen_at) < ONLINE_THRESHOLD_MS ? 'online' : 'offline';
}

// ── Validation rules ──────────────────────────────────────────────────────────
const nameRules = [
    body('name')
        .trim()
        .notEmpty().withMessage('name is required')
        .isLength({ max: 50 }).withMessage('Device name is too long (max 50)'),
];

router.use(requireAuth);

// List user's devices
router.get('/', (req, res) => {
    const rows = db.prepare(`
        SELECT g.id, g.name, g.registration_code, g.reg_code_expires_at,
               g.registered_at, g.last_seen_at, g.warning, g.token,
               COUNT(se.id) AS sos_count
        FROM gateways g
        LEFT JOIN sos_events se ON se.device_db_id = g.id
        WHERE g.owner_id = ?
        GROUP BY g.id
        ORDER BY g.registered_at DESC
    `).all(req.user.id);

    const devices = rows.map(d => ({
        id:                  d.id,
        name:                d.name,
        registration_code:   d.registration_code,
        reg_code_expires_at: d.reg_code_expires_at,
        registered_at:       d.registered_at,
        last_seen_at:        d.last_seen_at,
        warning:             d.warning,
        sos_count:           d.sos_count || 0,
        status:              computeStatus(d),
    }));

    res.json({ devices });
});

// Create device slot
router.post('/', nameRules, validate, (req, res) => {
    const name      = req.body.name.trim();
    const code      = generateRegistrationCode();
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

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
});

// Rename device
router.patch('/:id', nameRules, validate, (req, res) => {
    const name   = req.body.name.trim();
    const device = db.prepare('SELECT id FROM gateways WHERE id = ? AND owner_id = ?')
                     .get(req.params.id, req.user.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    db.prepare('UPDATE gateways SET name = ? WHERE id = ?').run(name, device.id);
    res.json({ ok: true, name });
});

// Delete device and all its SOS history
router.delete('/:id', (req, res) => {
    const device = db.prepare('SELECT id FROM gateways WHERE id = ? AND owner_id = ?')
                     .get(req.params.id, req.user.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    db.prepare('DELETE FROM sos_events WHERE device_db_id = ?').run(device.id);
    db.prepare('DELETE FROM gateways   WHERE id = ?').run(device.id);
    res.json({ ok: true });
});

module.exports = router;
