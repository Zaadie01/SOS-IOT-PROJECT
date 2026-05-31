const crypto = require('crypto');
const db     = require('../db');
const ws     = require('../websocket');

function registerGateway(req, res) {
    const { registration_code } = req.body;

    const slot = db.prepare(`
        SELECT * FROM gateways
        WHERE registration_code = ? AND reg_code_expires_at > ?
    `).get(registration_code, Date.now());

    if (!slot) return res.status(401).json({ error: 'Invalid or expired registration code' });

    const token = crypto.randomBytes(32).toString('hex');

    db.prepare(`
        UPDATE gateways
        SET    token = ?, registered_at = ?,
               registration_code = NULL, reg_code_expires_at = NULL
        WHERE  id = ?
    `).run(token, Date.now(), slot.id);

    console.log(`[gateway] Registered: id=${slot.id} name="${slot.name}"`);
    res.status(201).json({ token, device_id: slot.id });
}

function handleSosData(req, res) {
    const gateway   = req.gateway;          // set by requireGateway middleware
    const now       = Date.now();
    const eventTime = req.body.timestamp || now;

    db.prepare('UPDATE gateways SET last_seen_at = ? WHERE id = ?').run(now, gateway.id);

    if (!req.body.sos_alert) return res.json({ success: true });

    const { lastInsertRowid } = db.prepare(`
        INSERT INTO sos_events (timestamp, button_pressed, device_db_id, synced_at)
        VALUES (?, ?, ?, ?)
    `).run(eventTime, req.body.button_pressed ?? null, gateway.id, now);

    const sosEvent = {
        id:            lastInsertRowid,
        timestamp:     eventTime,
        synced_at:     now,
        button_pressed: req.body.button_pressed,
        device_name:   gateway.name,
        device_db_id:  gateway.id,
    };

    console.log(`🚨 SOS from "${gateway.name}"`);
    ws.broadcast({ type: 'sos', event: sosEvent });

    res.status(201).json({ success: true, id: lastInsertRowid });
}

function handleHeartbeat(req, res) {
    const gateway = req.gateway;
    db.prepare('UPDATE gateways SET last_seen_at = ? WHERE id = ?').run(Date.now(), gateway.id);
    res.json({ ok: true, server_time: Date.now() });
}

function handleWarning(req, res) {
    const gateway = req.gateway;
    const warning = req.body.message ? String(req.body.message).trim() : null;

    db.prepare('UPDATE gateways SET last_seen_at = ?, warning = ? WHERE id = ?')
      .run(Date.now(), warning, gateway.id);

    res.json({ ok: true });
}

module.exports = { registerGateway, handleSosData, handleHeartbeat, handleWarning };
