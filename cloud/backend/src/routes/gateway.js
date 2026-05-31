const router = require('express').Router();
const crypto = require('crypto');
const { body } = require('express-validator');
const db     = require('../db');
const ws     = require('../websocket');
const { validate } = require('../middleware/validate');

// ── Validation rules ──────────────────────────────────────────────────────────
const registerRules = [
    body('registration_code')
        .notEmpty().withMessage('registration_code is required')
        .isLength({ min: 8, max: 8 }).withMessage('registration_code must be exactly 8 characters'),
];

const dataRules = [
    body('sos_alert').isBoolean().withMessage('sos_alert must be a boolean'),
    body('button_pressed').optional().isInt({ min: 0 }).withMessage('button_pressed must be a non-negative integer'),
    body('timestamp').optional().isInt({ min: 0 }).withMessage('timestamp must be a positive integer'),
];

const warningRules = [
    body('message')
        .optional({ nullable: true })
        .isLength({ max: 200 }).withMessage('Warning message is too long (max 200)'),
];

// ── Helper — authenticate device by gateway token ─────────────────────────────
function gatewayFromToken(req, res) {
    const token = req.headers['x-gateway-token'];
    if (!token) {
        res.status(401).json({ error: 'Missing x-gateway-token header' });
        return null;
    }
    const gateway = db.prepare('SELECT * FROM gateways WHERE token = ?').get(token);
    if (!gateway) {
        res.status(401).json({ error: 'Unauthorized' });
        return null;
    }
    return gateway;
}

// ── Register a device using a one-time code ───────────────────────────────────
router.post('/gateway/register', registerRules, validate, (req, res) => {
    const { registration_code } = req.body;

    const slot = db.prepare(`
        SELECT * FROM gateways
        WHERE registration_code = ? AND reg_code_expires_at > ?
    `).get(registration_code, Date.now());

    if (!slot) return res.status(401).json({ error: 'Invalid or expired registration code' });

    const token = crypto.randomBytes(32).toString('hex');
    db.prepare(`
        UPDATE gateways
        SET token = ?, registered_at = ?, registration_code = NULL, reg_code_expires_at = NULL
        WHERE id = ?
    `).run(token, Date.now(), slot.id);

    console.log(`[gateway] Registered: id=${slot.id} name="${slot.name}"`);
    res.status(201).json({ token, device_id: slot.id });
});

// ── SOS event from firmware ───────────────────────────────────────────────────
router.post('/gateway/data', dataRules, validate, (req, res) => {
    const gateway = gatewayFromToken(req, res);
    if (!gateway) return;

    const now       = Date.now();
    const eventTime = req.body.timestamp || now;

    db.prepare('UPDATE gateways SET last_seen_at = ? WHERE id = ?').run(now, gateway.id);

    if (!req.body.sos_alert) return res.json({ success: true });

    const { lastInsertRowid } = db.prepare(`
        INSERT INTO sos_events (timestamp, button_pressed, device_db_id, synced_at)
        VALUES (?, ?, ?, ?)
    `).run(eventTime, req.body.button_pressed ?? null, gateway.id, now);

    const event = { id: lastInsertRowid, timestamp: eventTime, synced_at: now, button_pressed: req.body.button_pressed, device_name: gateway.name, device_db_id: gateway.id };
    console.log(`🚨 SOS from "${gateway.name}"`);
    ws.broadcast({ type: 'sos', event });
    res.status(201).json({ success: true, id: lastInsertRowid });
});

// ── Heartbeat ─────────────────────────────────────────────────────────────────
router.post('/gateway/ping', (req, res) => {
    const gateway = gatewayFromToken(req, res);
    if (!gateway) return;
    db.prepare('UPDATE gateways SET last_seen_at = ? WHERE id = ?').run(Date.now(), gateway.id);
    res.json({ ok: true, server_time: Date.now() });
});

// ── Warning message ───────────────────────────────────────────────────────────
router.post('/gateway/warning', warningRules, validate, (req, res) => {
    const gateway = gatewayFromToken(req, res);
    if (!gateway) return;
    const warning = req.body.message ? String(req.body.message).trim() : null;
    db.prepare('UPDATE gateways SET last_seen_at = ?, warning = ? WHERE id = ?')
      .run(Date.now(), warning, gateway.id);
    res.json({ ok: true });
});

module.exports = router;
