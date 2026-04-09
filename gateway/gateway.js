// gateway.js - Serial gateway with SQLite persistence and cloud upload
require('dotenv').config();

const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const axios = require('axios');
const Database = require('better-sqlite3');
const express = require('express');

const CONFIG = {
    serialPort:         process.env.SERIAL_PORT         || '/dev/ttyUSB0',
    baudRate:           115200,
    cloudUrl:           process.env.CLOUD_URL            || 'http://localhost:3001',
    gatewayId:          process.env.GATEWAY_ID           || 'gateway-001',
    deviceId:           process.env.DEVICE_ID            || 'hardwario-001',
    registrationSecret: process.env.REGISTRATION_SECRET  || '',
    // gatewayToken is loaded from DB after registration — not set here
    gatewayToken:       '',
    dbPath:             process.env.DB_PATH              || '/data/gateway.db',
    dashboardPort:      parseInt(process.env.DASHBOARD_PORT) || 8080,
    // How often to retry uploading pending events to cloud
    uploadIntervalMs:   parseInt(process.env.UPLOAD_INTERVAL_MS)   || 30 * 1000,
    // Sent events are deleted after this retention period (24 h).
    // Unsent events are never deleted — infinite retention until uploaded.
    sentRetentionMs:    parseInt(process.env.SENT_RETENTION_MS)    || 24 * 60 * 60 * 1000,
    // How long to wait between registration retry attempts
    registerRetryMs:    parseInt(process.env.REGISTER_RETRY_MS)    || 10 * 1000,
    // How often to send a heartbeat ping to the cloud
    heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS) || 60 * 1000,
};

// ---------------------------------------------------------------------------
// SQLite setup
// ---------------------------------------------------------------------------

const db = new Database(CONFIG.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
    CREATE TABLE IF NOT EXISTS events (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id      TEXT    NOT NULL,
        button_pressed INTEGER NOT NULL,
        received_at    INTEGER NOT NULL,
        sent_at        INTEGER
    );

    CREATE TABLE IF NOT EXISTS gateway_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
`);

const stmtInsertEvent  = db.prepare(
    'INSERT INTO events (device_id, button_pressed, received_at) VALUES (?, ?, ?)'
);
const stmtGetPending   = db.prepare(
    'SELECT * FROM events WHERE sent_at IS NULL ORDER BY received_at ASC'
);
const stmtMarkSent     = db.prepare(
    'UPDATE events SET sent_at = ? WHERE id = ?'
);
const stmtDeleteOldSent = db.prepare(
    'DELETE FROM events WHERE sent_at IS NOT NULL AND sent_at < ?'
);
const stmtPendingCount = db.prepare(
    'SELECT COUNT(*) as cnt FROM events WHERE sent_at IS NULL'
);
const stmtSentCount    = db.prepare(
    'SELECT COUNT(*) as cnt FROM events WHERE sent_at IS NOT NULL'
);
const stmtLastEvent    = db.prepare(
    'SELECT received_at FROM events ORDER BY received_at DESC LIMIT 1'
);

// ---------------------------------------------------------------------------
// Gateway state (for dashboard)
// ---------------------------------------------------------------------------

const state = {
    cloudOnline:     false,
    serialConnected: false,
    lastEventAt:     null,
    lastUploadAt:    null,
    startedAt:       Date.now(),
};

// ---------------------------------------------------------------------------
// Registration — obtain a token from the cloud on first startup,
// then reuse the saved token on subsequent restarts.
// ---------------------------------------------------------------------------

const stmtGetMeta = db.prepare('SELECT value FROM gateway_meta WHERE key = ?');
const stmtSetMeta = db.prepare('INSERT OR REPLACE INTO gateway_meta (key, value) VALUES (?, ?)');

async function registerWithCloud() {
    // Check if we already have a saved token from a previous registration
    const saved = stmtGetMeta.get('token');
    if (saved) {
        CONFIG.gatewayToken = saved.value;
        console.log('[REGISTER] Loaded saved token from local DB');
        return;
    }

    if (!CONFIG.registrationSecret) {
        console.error('[REGISTER] REGISTRATION_SECRET is not set — cannot register with cloud');
        process.exit(1);
    }

    // Retry loop: keep trying until the cloud is reachable
    let firstAttempt = true;
    while (true) {
        try {
            if (firstAttempt) console.log(`[REGISTER] Registering gateway "${CONFIG.gatewayId}" with cloud...`);
            const res = await axios.post(
                `${CONFIG.cloudUrl}/api/gateway/register`,
                {
                    gateway_id: CONFIG.gatewayId,
                    device_id:  CONFIG.deviceId,
                    secret:     CONFIG.registrationSecret,
                },
                { timeout: 5000 }
            );

            CONFIG.gatewayToken = res.data.token;
            stmtSetMeta.run('token', CONFIG.gatewayToken);
            console.log('[REGISTER] Registration successful — token saved to local DB');
            return;
        } catch (err) {
            if (firstAttempt) {
                console.error(`[REGISTER] Cloud unreachable: ${err.message} — will keep retrying silently`);
                firstAttempt = false;
            }
            await new Promise(r => setTimeout(r, CONFIG.registerRetryMs));
        }
    }
}

// ---------------------------------------------------------------------------
// Event ingestion
// ---------------------------------------------------------------------------

function storeEvent(deviceId, buttonPressed) {
    stmtInsertEvent.run(deviceId, buttonPressed, Date.now());
    state.lastEventAt = Date.now();
    console.log(`[EVENT] Stored: device=${deviceId} clicks=${buttonPressed}`);
}

// ---------------------------------------------------------------------------
// Cloud health check — runs when there is nothing to upload
// ---------------------------------------------------------------------------

async function pingCloud() {
    try {
        await axios.get(`${CONFIG.cloudUrl}/`, { timeout: 5000 });
        if (!state.cloudOnline) console.log('[PING] Cloud back online');
        state.cloudOnline = true;
    } catch {
        if (state.cloudOnline) console.error('[PING] Cloud went offline');
        state.cloudOnline = false;
    }
}

// ---------------------------------------------------------------------------
// Heartbeat — periodically tell the cloud we are alive
// ---------------------------------------------------------------------------

async function heartbeat() {
    if (!CONFIG.gatewayToken) return; // not registered yet
    try {
        const res = await axios.post(
            `${CONFIG.cloudUrl}/api/gateway/ping`,
            {},
            {
                headers: { 'x-gateway-token': CONFIG.gatewayToken },
                timeout: 5000,
            }
        );
        if (!state.cloudOnline) console.log('[HEARTBEAT] Cloud back online');
        state.cloudOnline = true;
        console.log(`[HEARTBEAT] OK — server_time=${res.data.server_time}`);
    } catch (err) {
        if (state.cloudOnline) console.error(`[HEARTBEAT] Cloud offline: ${err.message}`);
        state.cloudOnline = false;
    }
}

// ---------------------------------------------------------------------------
// Cloud upload
// ---------------------------------------------------------------------------

let uploading = false;

async function uploadPending() {
    if (uploading) return;
    uploading = true;
    try {
        const pending = stmtGetPending.all();
        if (pending.length === 0) {
            await pingCloud();
            return;
        }

        for (const event of pending) {
            try {
                await axios.post(
                    `${CONFIG.cloudUrl}/api/gateway/data`,
                    {
                        timestamp:      event.received_at,
                        device_id:      event.device_id,
                        gateway_id:     CONFIG.gatewayId,
                        sos_alert:      1,
                        button_pressed: event.button_pressed,
                    },
                    {
                        headers: {
                            'Content-Type':    'application/json',
                            'x-gateway-token': CONFIG.gatewayToken,
                        },
                        timeout: 5000,
                    }
                );
                stmtMarkSent.run(Date.now(), event.id);
                if (!state.cloudOnline) console.log('[UPLOAD] Cloud back online');
                state.cloudOnline  = true;
                state.lastUploadAt = Date.now();
                console.log(`[UPLOAD] Sent event id=${event.id}`);
            } catch (err) {
                if (state.cloudOnline) console.error(`[UPLOAD] Cloud offline: ${err.message}`);
                state.cloudOnline = false;
                break;
            }
        }
    } finally {
        uploading = false;
    }
}

// ---------------------------------------------------------------------------
// Retention cleanup — delete sent events older than 24 h
// ---------------------------------------------------------------------------

function cleanupSent() {
    const { changes } = stmtDeleteOldSent.run(Date.now() - CONFIG.sentRetentionMs);
    if (changes > 0) console.log(`[CLEANUP] Deleted ${changes} sent event(s) older than 24 h`);
}

// ---------------------------------------------------------------------------
// Serial port
// ---------------------------------------------------------------------------

const port = new SerialPort({ path: CONFIG.serialPort, baudRate: CONFIG.baudRate, autoOpen: false });
const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

parser.on('data', (line) => {
    const clean = line.trim();
    console.log(`[SERIAL] ${clean}`);

    if (clean.includes('SOS:BUTTON_PRESS')) {
        const parts = clean.split(':');
        const count = parseInt(parts[3]) || 1;
        console.log(`[EVENT] SOS! clicks=${count}`);
        storeEvent(CONFIG.deviceId, count);
        // Upload immediately — don't wait for the retry interval
        uploadPending().catch(console.error);
    }
});

port.on('error', (err) => {
    state.serialConnected = false;
    console.error('[SERIAL] Error:', err.message);
});

port.on('close', () => {
    state.serialConnected = false;
    console.log('[SERIAL] Port closed — reconnecting in 3 s...');
    setTimeout(openPort, 3000);
});

function openPort() {
    port.open((err) => {
        if (err) {
            console.error(`[SERIAL] Reconnect failed: ${err.message} — retrying in 3 s...`);
            setTimeout(openPort, 3000);
            return;
        }
        state.serialConnected = true;
        console.log(`[SERIAL] Reconnected to ${CONFIG.serialPort}`);
        port.set({ dtr: false }, () => {
            setTimeout(() => {
                port.set({ dtr: true }, () => {
                    console.log('[SERIAL] HARDWARIO reset complete, listening...');
                });
            }, 100);
        });
    });
}

async function initPort() {
    return new Promise((resolve, reject) => {
        port.open((err) => {
            if (err) { reject(err); return; }
            state.serialConnected = true;
            console.log(`[SERIAL] Connected to ${CONFIG.serialPort}`);
            port.set({ dtr: false }, () => {
                setTimeout(() => {
                    port.set({ dtr: true }, () => {
                        console.log('[SERIAL] HARDWARIO reset complete, listening...');
                        resolve();
                    });
                }, 100);
            });
        });
    });
}

// ---------------------------------------------------------------------------
// Dashboard — simple Express HTTP server on port 8080
// ---------------------------------------------------------------------------

const app = express();

app.get('/', (_req, res) => {
    const pending   = stmtPendingCount.get().cnt;
    const sent      = stmtSentCount.get().cnt;
    const lastRow   = stmtLastEvent.get();
    const lastEvent = lastRow ? new Date(lastRow.received_at).toLocaleString() : 'none';
    const uptime    = Math.floor((Date.now() - state.startedAt) / 1000);

    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="10">
  <title>SOS Gateway Dashboard</title>
  <style>
    body { font-family: monospace; background: #0f0f0f; color: #e0e0e0; padding: 2rem; }
    h1   { color: #ff4444; margin-bottom: 0.5rem; }
    h2   { color: #aaa; font-size: 0.9rem; margin-top: 0; margin-bottom: 2rem; font-weight: normal; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; }
    .card { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 1.2rem; }
    .card .label { font-size: 0.75rem; color: #888; text-transform: uppercase; letter-spacing: 1px; }
    .card .value { font-size: 1.6rem; font-weight: bold; margin-top: 0.3rem; }
    .ok   { color: #44ff88; }
    .warn { color: #ffaa44; }
    .err  { color: #ff4444; }
    footer { margin-top: 2rem; color: #555; font-size: 0.75rem; }
  </style>
</head>
<body>
  <h1>SOS Gateway Dashboard</h1>
  <h2>Gateway: ${CONFIG.gatewayId} &nbsp;|&nbsp; Device: ${CONFIG.deviceId}</h2>
  <div class="grid">
    <div class="card">
      <div class="label">Cloud connection</div>
      <div class="value ${state.cloudOnline ? 'ok' : 'err'}">${state.cloudOnline ? 'ONLINE' : 'OFFLINE'}</div>
    </div>
    <div class="card">
      <div class="label">Serial port</div>
      <div class="value ${state.serialConnected ? 'ok' : 'err'}">${state.serialConnected ? 'CONNECTED' : 'DISCONNECTED'}</div>
    </div>
    <div class="card">
      <div class="label">Pending (not sent)</div>
      <div class="value ${pending > 0 ? 'warn' : 'ok'}">${pending}</div>
    </div>
    <div class="card">
      <div class="label">Sent (in retention)</div>
      <div class="value">${sent}</div>
    </div>
    <div class="card">
      <div class="label">Last SOS event</div>
      <div class="value" style="font-size:1rem; padding-top:0.5rem">${lastEvent}</div>
    </div>
    <div class="card">
      <div class="label">Last upload</div>
      <div class="value" style="font-size:1rem; padding-top:0.5rem">${state.lastUploadAt ? new Date(state.lastUploadAt).toLocaleString() : 'none'}</div>
    </div>
    <div class="card">
      <div class="label">Uptime</div>
      <div class="value" style="font-size:1rem; padding-top:0.5rem">${Math.floor(uptime/3600)}h ${Math.floor((uptime%3600)/60)}m ${uptime%60}s</div>
    </div>
  </div>
  <footer>Auto-refreshes every 10 s &nbsp;|&nbsp; Cloud: ${CONFIG.cloudUrl} &nbsp;|&nbsp; DB: ${CONFIG.dbPath}</footer>
</body>
</html>`);
});

app.get('/status', (_req, res) => {
    res.json({
        gateway_id:       CONFIG.gatewayId,
        device_id:        CONFIG.deviceId,
        cloud_online:     state.cloudOnline,
        serial_connected: state.serialConnected,
        pending_events:   stmtPendingCount.get().cnt,
        sent_events:      stmtSentCount.get().cnt,
        last_event_at:    state.lastEventAt,
        last_upload_at:   state.lastUploadAt,
        uptime_ms:        Date.now() - state.startedAt,
    });
});

app.listen(CONFIG.dashboardPort, () => {
    console.log(`[DASHBOARD] http://localhost:${CONFIG.dashboardPort}`);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

process.on('SIGINT', () => {
    console.log('\n[GATEWAY] Shutting down...');
    port.close(() => { db.close(); process.exit(0); });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

console.log('╔══════════════════════════════════════╗');
console.log('║   HARDWARIO SOS Gateway              ║');
console.log('╚══════════════════════════════════════╝');
console.log(`Serial:      ${CONFIG.serialPort} @ ${CONFIG.baudRate}`);
console.log(`Cloud:       ${CONFIG.cloudUrl}`);
console.log(`Device:      ${CONFIG.deviceId}`);
console.log(`Gateway:     ${CONFIG.gatewayId}`);
console.log(`DB:          ${CONFIG.dbPath}`);
console.log(`Upload:      every ${CONFIG.uploadIntervalMs / 1000} s`);
console.log(`Retention:   sent events kept ${CONFIG.sentRetentionMs / 3600000} h`);
console.log(`Dashboard:   http://localhost:${CONFIG.dashboardPort}\n`);

// Upload + cleanup timer — retry any pending events every 30 s
setInterval(async () => {
    await uploadPending();
    cleanupSent();
}, CONFIG.uploadIntervalMs);

// Heartbeat timer — let the cloud know we are alive
setInterval(() => heartbeat().catch(console.error), CONFIG.heartbeatIntervalMs);

// Serial port starts immediately — no cloud required to receive local SOS events
initPort().catch((err) => {
    console.error('[STARTUP] Serial port error:', err.message);
});

// Registration and upload run in parallel — cloud is optional for local operation
registerWithCloud()
    .then(() => uploadPending().catch(console.error))
    .catch((err) => {
        console.error('[STARTUP] Fatal error:', err.message);
        process.exit(1);
    });
