// server.js
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { WebSocketServer } = require('ws');

const app = express();
const PORT = process.env.PORT || 3001;
const REGISTRATION_SECRET = process.env.REGISTRATION_SECRET;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('combined'));

// Database setup
const dbPath = path.join(__dirname, '..', 'data', 'gateway_data.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err);
    } else {
        console.log('Connected to SQLite database');
        initDatabase();
    }
});

function initDatabase() {
    // Registered gateways — each gets its own unique token after registration
    db.run(`
        CREATE TABLE IF NOT EXISTS gateways (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            gateway_id    TEXT UNIQUE NOT NULL,
            device_id     TEXT,
            token         TEXT UNIQUE NOT NULL,
            registered_at INTEGER NOT NULL,
            last_seen_at  INTEGER
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS sos_events (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp      INTEGER NOT NULL,
            device_id      TEXT NOT NULL,
            button_pressed INTEGER,
            gateway_id     TEXT,
            synced_at      INTEGER
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

// ---------------------------------------------------------------------------
// Helper — validate gateway token against DB, call cb(err, gateway)
// ---------------------------------------------------------------------------
function validateToken(token, cb) {
    if (!token) return cb(null, null);
    db.get('SELECT * FROM gateways WHERE token = ?', [token], cb);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Health check
app.get('/', (_req, res) => {
    res.json({
        status: 'OK',
        message: 'SOS Gateway Backend API',
        timestamp: new Date().toISOString(),
        ws_clients: wss.clients.size,
    });
});

// Register a new gateway and receive a unique token
// Body: { gateway_id, device_id, secret }
app.post('/api/gateway/register', (req, res) => {
    if (!REGISTRATION_SECRET) {
        return res.status(503).json({ error: 'Registration not configured on server' });
    }

    const { gateway_id, device_id, secret } = req.body;

    if (!gateway_id || !secret) {
        return res.status(400).json({ error: 'gateway_id and secret are required' });
    }

    if (secret !== REGISTRATION_SECRET) {
        console.warn(`[REGISTER] Bad secret from gateway_id=${gateway_id}`);
        return res.status(401).json({ error: 'Invalid registration secret' });
    }

    const token = crypto.randomBytes(32).toString('hex');

    db.run(
        `INSERT OR REPLACE INTO gateways (gateway_id, device_id, token, registered_at)
         VALUES (?, ?, ?, ?)`,
        [gateway_id, device_id || null, token, Date.now()],
        function (err) {
            if (err) {
                console.error('[REGISTER] DB error:', err);
                return res.status(500).json({ error: 'Failed to register gateway' });
            }
            console.log(`[REGISTER] Gateway registered: id=${gateway_id} device=${device_id}`);
            res.status(201).json({ token });
        }
    );
});

// Receive SOS event from Gateway
app.post('/api/gateway/data', (req, res) => {
    const incomingToken = req.headers['x-gateway-token'];

    validateToken(incomingToken, (err, gateway) => {
        if (err) {
            console.error('[AUTH] DB error:', err);
            return res.status(500).json({ error: 'Internal error' });
        }
        if (!gateway) {
            return res.status(401).json({ error: 'Unauthorized — gateway not registered' });
        }

        // Update last_seen_at
        db.run('UPDATE gateways SET last_seen_at = ? WHERE id = ?', [Date.now(), gateway.id]);

        const { timestamp, device_id, button_pressed, gateway_id, sos_alert } = req.body;

        if (!sos_alert) {
            return res.status(200).json({ success: true, message: 'Non-SOS data ignored' });
        }

        const sql = `
            INSERT INTO sos_events (timestamp, device_id, button_pressed, gateway_id, synced_at)
            VALUES (?, ?, ?, ?, ?)
        `;

        db.run(sql, [timestamp, device_id, button_pressed, gateway_id, Date.now()], function (err) {
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
});

// Heartbeat — gateway confirms it is alive
app.post('/api/gateway/ping', (req, res) => {
    const incomingToken = req.headers['x-gateway-token'];

    validateToken(incomingToken, (err, gateway) => {
        if (err) {
            console.error('[PING] DB error:', err);
            return res.status(500).json({ error: 'Internal error' });
        }
        if (!gateway) {
            return res.status(401).json({ error: 'Unauthorized — gateway not registered' });
        }

        db.run('UPDATE gateways SET last_seen_at = ? WHERE id = ?', [Date.now(), gateway.id]);
        console.log(`[PING] Heartbeat from gateway: ${gateway.gateway_id}`);
        res.json({ ok: true, server_time: Date.now() });
    });
});

// Get SOS history
app.get('/api/alerts/sos', (req, res) => {
    db.all(`SELECT * FROM sos_events ORDER BY timestamp DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ alerts: rows });
    });
});

// Get registered gateways (for cloud dashboard)
app.get('/api/gateways', (req, res) => {
    db.all(
        `SELECT gateway_id, device_id, registered_at, last_seen_at FROM gateways ORDER BY registered_at DESC`,
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ gateways: rows });
        }
    );
});

// Get single gateway status by ID
app.get('/api/gateways/:gateway_id', (req, res) => {
    db.get(
        `SELECT gateway_id, device_id, registered_at, last_seen_at FROM gateways WHERE gateway_id = ?`,
        [req.params.gateway_id],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row) return res.status(404).json({ error: 'Gateway not found' });
            res.json({ gateway: row });
        }
    );
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
