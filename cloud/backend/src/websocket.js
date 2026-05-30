const { WebSocketServer } = require('ws');

let wss;

function init(httpServer) {
    wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    wss.on('connection', ws => {
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

function clientCount() {
    return wss ? wss.clients.size : 0;
}

module.exports = { init, broadcast, clientCount };
