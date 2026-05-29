const express = require('express');
const { requireAuth } = require('../middleware/auth');

module.exports = function alertRoutes(db) {
    const router = express.Router();

    router.get('/sos', requireAuth, (req, res) => {
        try {
            const rows = db.prepare(
                'SELECT * FROM sos_events ORDER BY timestamp DESC'
            ).all();
            res.json({ alerts: rows });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
