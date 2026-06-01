const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-dev-secret';

let wss;

function init(httpServer) {
    wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    wss.on('connection', (ws, req) => {
        try {
            const url   = new URL(req.url, 'http://localhost');
            const token = url.searchParams.get('token');
            if (token) {
                const decoded = jwt.verify(token, JWT_SECRET);
                ws.userId = decoded.id;
            }
        } catch (_) {}

        console.log(`[ws] Client connected  (total: ${wss.clients.size})`);
        ws.on('close', () => console.log(`[ws] Client disconnected (total: ${wss.clients.size})`));
    });
}

function broadcast(data) {
    if (!wss) return;
    const msg = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === 1) client.send(msg);
    });
}

function sendToUsers(userIds, data) {
    if (!wss) return;
    const msg   = JSON.stringify(data);
    const idSet = new Set(userIds);
    wss.clients.forEach(client => {
        if (client.readyState === 1 && idSet.has(client.userId)) {
            client.send(msg);
        }
    });
}

function clientCount() {
    return wss ? wss.clients.size : 0;
}

module.exports = { init, broadcast, sendToUsers, clientCount };
