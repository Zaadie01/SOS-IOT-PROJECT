const express = require('express');
const crypto = require('crypto');

module.exports = function gatewayRoutes(db, broadcast) {
    const router = express.Router();

    // ── Firmware → Server ─────────────────────────────────────────────────────

    // Register using a one-time code — no gateway_id or device_id needed
    router.post('/gateway/register', (req, res) => {
        const { registration_code } = req.body;
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
            SET token = ?, registered_at = ?, registration_code = NULL, reg_code_expires_at = NULL
            WHERE id = ?
        `).run(token, Date.now(), slot.id);

        console.log(`[REGISTER] Device registered: id=${slot.id} name="${slot.name}"`);
        res.status(201).json({ token, device_id: slot.id });
    });

    // Receive SOS event — device identified by token only
    router.post('/gateway/data', (req, res) => {
        const incomingToken = req.headers['x-gateway-token'];
        if (!incomingToken) return res.status(401).json({ error: 'Missing x-gateway-token header' });

        const gateway = db.prepare('SELECT * FROM gateways WHERE token = ?').get(incomingToken);
        if (!gateway) return res.status(401).json({ error: 'Unauthorized' });

        db.prepare('UPDATE gateways SET last_seen_at = ? WHERE id = ?').run(Date.now(), gateway.id);

        const { timestamp, button_pressed, sos_alert } = req.body;
        if (!sos_alert) return res.json({ success: true });

        const result = db.prepare(`
            INSERT INTO sos_events (timestamp, button_pressed, device_db_id, synced_at)
            VALUES (?, ?, ?, ?)
        `).run(timestamp, button_pressed, gateway.id, Date.now());

        const event = { id: result.lastInsertRowid, timestamp, button_pressed, device_name: gateway.name };
        console.log(`🚨 SOS from "${gateway.name}" — clicks: ${button_pressed}`);
        broadcast({ type: 'sos', event });
        res.status(201).json({ success: true, id: result.lastInsertRowid });
    });

    // Heartbeat
    router.post('/gateway/ping', (req, res) => {
        const incomingToken = req.headers['x-gateway-token'];
        if (!incomingToken) return res.status(401).json({ error: 'Missing x-gateway-token header' });

        const gateway = db.prepare('SELECT * FROM gateways WHERE token = ?').get(incomingToken);
        if (!gateway) return res.status(401).json({ error: 'Unauthorized' });

        db.prepare('UPDATE gateways SET last_seen_at = ? WHERE id = ?').run(Date.now(), gateway.id);
        res.json({ ok: true, server_time: Date.now() });
    });

    // Warning
    router.post('/gateway/warning', (req, res) => {
        const incomingToken = req.headers['x-gateway-token'];
        if (!incomingToken) return res.status(401).json({ error: 'Missing x-gateway-token header' });

        const gateway = db.prepare('SELECT * FROM gateways WHERE token = ?').get(incomingToken);
        if (!gateway) return res.status(401).json({ error: 'Unauthorized' });

        const warning = req.body.message || null;
        db.prepare('UPDATE gateways SET last_seen_at = ?, warning = ? WHERE id = ?')
          .run(Date.now(), warning, gateway.id);
        res.json({ ok: true });
    });

    return router;
};
