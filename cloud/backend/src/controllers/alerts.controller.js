const db = require('../db');

function listAlerts(req, res) {
    const { device_id } = req.query;

    const rows = device_id
        ? db.prepare(`
            SELECT se.id, se.timestamp, se.synced_at, se.device_db_id,
                   g.name AS device_name
            FROM   sos_events se
            JOIN   gateways g ON g.id = se.device_db_id
            WHERE  g.owner_id = ? AND g.id = ?
            ORDER  BY se.synced_at DESC
          `).all(req.user.id, device_id)
        : db.prepare(`
            SELECT se.id, se.timestamp, se.synced_at, se.device_db_id,
                   g.name AS device_name
            FROM   sos_events se
            JOIN   gateways g ON g.id = se.device_db_id
            WHERE  g.owner_id = ?
            ORDER  BY se.synced_at DESC
          `).all(req.user.id);

    res.json({ alerts: rows });
}

module.exports = { listAlerts };
