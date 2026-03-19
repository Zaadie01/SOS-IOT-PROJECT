const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { WebSocketServer } = require('ws');

const app = express();
const PORT = process.env.PORT || 3001;
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('combined'));

// Database setup
const dbPath = path.join(__dirname, 'data', 'gateway_data.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err);
    } else {
        console.log('Connected to SQLite database');
        initDatabase();
    }
});

function initDatabase() {
    db.run(`
        CREATE TABLE IF NOT EXISTS sos_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER NOT NULL,
            device_id TEXT NOT NULL,
            button_pressed INTEGER,
            gateway_id TEXT,
            synced_at INTEGER
        )
    `);

}

// WebSocket server
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
    console.log('[WS] Client connected, total:', wss.clients.size);
    ws.on('close', () => console.log('[WS] Client disconnected, total:', wss.clients.size));
});

function broadcast(data) {
    const msg = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === 1) client.send(msg);
    });
}

// Routes

// Health check
app.get('/', (_req, res) => {
    res.json({
        status: 'OK',
        message: 'SOS Gateway Backend API',
        timestamp: new Date().toISOString(),
        ws_clients: wss.clients.size,
    });
});

// Receive SOS event from Gateway
app.post('/api/gateway/data', (req, res) => {
    if (GATEWAY_TOKEN && req.headers['x-gateway-token'] !== GATEWAY_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { timestamp, device_id, button_pressed, gateway_id, sos_alert } = req.body;

    if (!sos_alert) {
        return res.status(200).json({ success: true, message: 'Non-SOS data ignored' });
    }

    const sql = `
        INSERT INTO sos_events (timestamp, device_id, button_pressed, gateway_id, synced_at)
        VALUES (?, ?, ?, ?, ?)
    `;

    db.run(sql, [timestamp, device_id, button_pressed, gateway_id, Date.now()], function(err) {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Failed to store data' });
        }

        const event = { id: this.lastID, timestamp, device_id, button_pressed, gateway_id };

        console.log('🚨 SOS ALERT from device:', device_id, '— clicks:', button_pressed);
        broadcast({ type: 'sos', event });

        res.status(201).json({ success: true, id: this.lastID });
    });
});

// Get SOS history
app.get('/api/alerts/sos', (req, res) => {
    db.all(`SELECT * FROM sos_events ORDER BY timestamp DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ alerts: rows });
    });
});

// Start
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`🔌 WebSocket on ws://localhost:${PORT}/ws`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    wss.close();
    db.close((err) => {
        if (err) console.error(err.message);
        console.log('Database connection closed.');
        process.exit(0);
    });
});
