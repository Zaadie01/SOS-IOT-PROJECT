const express = require('express');
const { requireAuth } = require('../middleware/auth');

module.exports = function alertRoutes(db) {
    const router = express.Router();

    // GET /api/alerts/sos?device_id=3  (optional filter by DB device id)
    router.get('/sos', requireAuth, (req, res) => {
        try {
            const { device_id } = req.query;

            const rows = device_id
                ? db.prepare(`
                    SELECT se.id, se.timestamp, se.button_pressed, se.synced_at,
                           g.name AS device_name
                    FROM sos_events se
                    INNER JOIN gateways g ON g.gateway_id = se.gateway_id
                    WHERE g.owner_id = ? AND g.id = ?
                    ORDER BY se.timestamp DESC
                  `).all(req.user.id, device_id)
                : db.prepare(`
                    SELECT se.id, se.timestamp, se.button_pressed, se.synced_at,
                           g.name AS device_name
                    FROM sos_events se
                    INNER JOIN gateways g ON g.gateway_id = se.gateway_id
                    WHERE g.owner_id = ?
                    ORDER BY se.timestamp DESC
                  `).all(req.user.id);

            res.json({ alerts: rows });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
