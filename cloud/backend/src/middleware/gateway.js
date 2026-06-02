const db = require('../db');

/**
 * Authenticates a request from IoT firmware using the x-gateway-token header.
 * Attaches the matching gateway row to req.gateway on success.
 */
function requireGateway(req, res, next) {
    const token = req.headers['x-gateway-token'];

    if (!token) {
        return res.status(401).json({ error: 'Missing x-gateway-token header' });
    }

    const gateway = db.prepare('SELECT * FROM devices WHERE token = ?').get(token);

    if (!gateway) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    req.gateway = gateway;
    next();
}

module.exports = { requireGateway };
