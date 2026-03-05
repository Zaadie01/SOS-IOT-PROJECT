const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('combined'));

// Database setup
const dbPath = path.join(__dirname, 'gateway_data.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err);
    } else {
        console.log('Connected to SQLite database');
        initDatabase();
    }
});

// Initialize database tables
function initDatabase() {
    db.run(`
        CREATE TABLE IF NOT EXISTS sensor_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER NOT NULL,
            device_id TEXT NOT NULL,
            temperature REAL,
            button_pressed INTEGER,
            accel_x REAL,
            accel_y REAL,
            accel_z REAL,
            sos_alert INTEGER,
            gateway_id TEXT,
            synced_at INTEGER
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS gateways (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            gateway_id TEXT UNIQUE NOT NULL,
            name TEXT,
            location TEXT,
            last_seen INTEGER,
            auth_token TEXT,
            created_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
    `);
}

// Routes

// Health check
app.get('/', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'SOS Gateway Backend API',
        timestamp: new Date().toISOString()
    });
});

// Receive data from Gateway
app.post('/api/gateway/data', (req, res) => {
    const { timestamp, device_id, temperature, button_pressed, accel_x, accel_y, accel_z, sos_alert, gateway_id } = req.body;
    
    const sql = `
        INSERT INTO sensor_data (timestamp, device_id, temperature, button_pressed, accel_x, accel_y, accel_z, sos_alert, gateway_id, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    db.run(sql, [timestamp, device_id, temperature, button_pressed ? 1 : 0, accel_x, accel_y, accel_z, sos_alert ? 1 : 0, gateway_id, Date.now()], function(err) {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Failed to store data' });
        }
        
        // If SOS alert, log it prominently
        if (sos_alert) {
            console.log('🚨 SOS ALERT received from device:', device_id);
        }
        
        res.status(201).json({ 
            success: true, 
            id: this.lastID,
            message: sos_alert ? 'SOS alert received' : 'Data stored'
        });
    });
});

// Get all data (for dashboard)
app.get('/api/data', (req, res) => {
    const sql = `SELECT * FROM sensor_data ORDER BY timestamp DESC LIMIT 100`;
    db.all(sql, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ data: rows });
    });
});

// Get SOS alerts only
app.get('/api/alerts/sos', (req, res) => {
    const sql = `SELECT * FROM sensor_data WHERE sos_alert = 1 ORDER BY timestamp DESC`;
    db.all(sql, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ alerts: rows });
    });
});

// Gateway registration
app.post('/api/gateways/register', (req, res) => {
    const { gateway_id, name, location } = req.body;
    const token = require('crypto').randomBytes(32).toString('hex');
    
    const sql = `INSERT INTO gateways (gateway_id, name, location, auth_token) VALUES (?, ?, ?, ?)`;
    
    db.run(sql, [gateway_id, name, location, token], function(err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(409).json({ error: 'Gateway already registered' });
            }
            return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ success: true, gateway_id, token });
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 API endpoints:`);
    console.log(`   GET  /                    - Health check`);
    console.log(`   POST /api/gateway/data    - Receive sensor data`);
    console.log(`   GET  /api/data            - Get all data`);
    console.log(`   GET  /api/alerts/sos      - Get SOS alerts`);
    console.log(`   POST /api/gateways/register - Register gateway`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Database connection closed.');
        process.exit(0);
    });
});
