const express = require('express');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');

module.exports = function gatewayRoutes(db, broadcast) {
    const router = express.Router();

    // ── Device → Server ───────────────────────────────────────────────────────

    // Register using a one-time registration_code created via POST /api/devices
    router.post('/gateway/register', (req, res) => {
        const { gateway_id, device_id, registration_code } = req.body;
        if (!gateway_id) {
            return res.status(400).json({ error: 'gateway_id is required' });
        }
        if (!registration_code) {
            return res.status(400).json({ error: 'registration_code is required' });
        }

        const slot = db.prepare(`
            SELECT * FROM gateways
            WHERE registration_code = ? AND reg_code_expires_at > ?
        `).get(registration_code, Date.now());

        if (!slot) {
            return res.status(401).json({ error: 'Invalid or expired registration code' });
        }

        const token = crypto.randomBytes(32).toString('hex');
        db.prepare(`
            UPDATE gateways
            SET gateway_id = ?, device_id = ?, token = ?, registered_at = ?,
                registration_code = NULL, reg_code_expires_at = NULL
            WHERE id = ?
        `).run(gateway_id, device_id || null, token, Date.now(), slot.id);

        console.log(`[REGISTER] Gateway registered: id=${gateway_id}`);
        res.status(201).json({ token });
    });

    // Receive data (SOS event)
    router.post('/gateway/data', (req, res) => {
        const incomingToken = req.headers['x-gateway-token'];
        if (!incomingToken) return res.status(401).json({ error: 'Missing x-gateway-token header' });

        const gateway = db.prepare('SELECT * FROM gateways WHERE token = ?').get(incomingToken);
        if (!gateway) return res.status(401).json({ error: 'Unauthorized — token not recognised' });

        db.prepare('UPDATE gateways SET last_seen_at = ? WHERE id = ?').run(Date.now(), gateway.id);

        const { timestamp, device_id, button_pressed, gateway_id, sos_alert } = req.body;
        if (!sos_alert) return res.json({ success: true, message: 'Non-SOS data ignored' });

        const result = db.prepare(`
            INSERT INTO sos_events (timestamp, device_id, button_pressed, gateway_id, synced_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(timestamp, device_id, button_pressed, gateway_id, Date.now());

        const event = { id: result.lastInsertRowid, timestamp, device_id, button_pressed, gateway_id };
        console.log('🚨 SOS ALERT from device:', device_id, '— clicks:', button_pressed);
        broadcast({ type: 'sos', event });
        res.status(201).json({ success: true, id: result.lastInsertRowid });
    });

    // Heartbeat ping
    router.post('/gateway/ping', (req, res) => {
        const incomingToken = req.headers['x-gateway-token'];
        if (!incomingToken) return res.status(401).json({ error: 'Missing x-gateway-token header' });

        const gateway = db.prepare('SELECT * FROM gateways WHERE token = ?').get(incomingToken);
        if (!gateway) return res.status(401).json({ error: 'Unauthorized' });

        db.prepare('UPDATE gateways SET last_seen_at = ? WHERE id = ?').run(Date.now(), gateway.id);
        console.log(`[PING] Gateway: ${gateway.gateway_id}`);
        res.json({ ok: true, server_time: Date.now() });
    });

    // Warning message
    router.post('/gateway/warning', (req, res) => {
        const incomingToken = req.headers['x-gateway-token'];
        if (!incomingToken) return res.status(401).json({ error: 'Missing x-gateway-token header' });

        const gateway = db.prepare('SELECT * FROM gateways WHERE token = ?').get(incomingToken);
        if (!gateway) return res.status(401).json({ error: 'Unauthorized' });

        const warning = req.body.message || null;
        db.prepare('UPDATE gateways SET last_seen_at = ?, warning = ? WHERE id = ?')
          .run(Date.now(), warning, gateway.id);

        if (warning) console.warn(`[WARNING] ${gateway.gateway_id}: ${warning}`);
        else console.log(`[WARNING] ${gateway.gateway_id}: warning cleared`);
        res.json({ ok: true });
    });

    // ── Admin / Dashboard ─────────────────────────────────────────────────────

    // List gateways — admin sees all, regular user sees only their own
    router.get('/gateways', requireAuth, (req, res) => {
        const isAdmin = req.user.role === 'admin';
        const rows = isAdmin
            ? db.prepare(`
                SELECT g.id, g.gateway_id, g.device_id, g.name, g.owner_id,
                       g.registered_at, g.last_seen_at, g.warning,
                       CASE WHEN g.token IS NOT NULL THEN 1 ELSE 0 END AS is_registered,
                       u.email AS owner_email
                FROM gateways g
                LEFT JOIN users u ON u.id = g.owner_id
                ORDER BY g.registered_at DESC
              `).all()
            : db.prepare(`
                SELECT g.id, g.gateway_id, g.device_id, g.name, g.owner_id,
                       g.registered_at, g.last_seen_at, g.warning,
                       CASE WHEN g.token IS NOT NULL THEN 1 ELSE 0 END AS is_registered
                FROM gateways g
                WHERE g.owner_id = ?
                ORDER BY g.registered_at DESC
              `).all(req.user.id);
        res.json({ gateways: rows });
    });

    // Single gateway — accessible only by owner or admin
    router.get('/gateways/:gateway_id', requireAuth, (req, res) => {
        const row = db.prepare(`
            SELECT g.id, g.gateway_id, g.device_id, g.name, g.owner_id,
                   g.registered_at, g.last_seen_at, g.warning,
                   CASE WHEN g.token IS NOT NULL THEN 1 ELSE 0 END AS is_registered
            FROM gateways g
            WHERE g.gateway_id = ?
        `).get(req.params.gateway_id);
        if (!row) return res.status(404).json({ error: 'Gateway not found' });
        if (req.user.role !== 'admin' && row.owner_id !== req.user.id) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        res.json({ gateway: row });
    });

    return router;
};
