const express = require('express');
const { requireAuth } = require('../middleware/auth');

module.exports = function alertRoutes(db) {
    const router = express.Router();

    // Returns only alerts from devices owned by the authenticated user
    router.get('/sos', requireAuth, (req, res) => {
        try {
            const rows = db.prepare(`
                SELECT se.*
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
