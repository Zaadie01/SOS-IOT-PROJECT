require('dotenv').config();

const http = require('http');
const app  = require('./app');
const db   = require('./db');
const ws   = require('./websocket');

const PORT = process.env.PORT || 3001;

const server = http.createServer(app);
ws.init(server);

server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`🔌 WebSocket  on ws://localhost:${PORT}/ws`);
});

process.on('SIGINT', () => {
    db.close();
    console.log('Database closed.');
    process.exit(0);
});
