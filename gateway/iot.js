// iot.js — HARDWARIO SOS Gateway
// Reads SOS events from serial port, stores them locally (SQLite),
// and uploads to the cloud when connectivity is available.
require('dotenv').config();

const { SerialPort }    = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const axios             = require('axios');
const Database          = require('better-sqlite3');
const express           = require('express');

const CONFIG = {
    serialPort:          process.env.SERIAL_PORT           || '/dev/ttyUSB0',
    baudRate:            115200,
    cloudUrl:            process.env.CLOUD_URL             || 'http://localhost:3001',
    // Registration code from the SOS IoT dashboard (Devices → Add Device)
    registrationCode:    process.env.REGISTRATION_CODE     || '',
    gatewayToken:        '',          // loaded from DB after first registration
    dbPath:              process.env.DB_PATH               || '/data/gateway.db',
    dashboardPort:       parseInt(process.env.DASHBOARD_PORT)      || 8080,
    uploadIntervalMs:    parseInt(process.env.UPLOAD_INTERVAL_MS)  || 30 * 1000,
    // Sent events are kept for retention period, then deleted.
    // Unsent events are never deleted — infinite retention until uploaded.
    sentRetentionMs:     parseInt(process.env.SENT_RETENTION_MS)   || 24 * 60 * 60 * 1000,
    registerRetryMs:     parseInt(process.env.REGISTER_RETRY_MS)   || 10 * 1000,
    heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS) || 60 * 1000,
};

// ── SQLite ────────────────────────────────────────────────────────────────────

const db = new Database(CONFIG.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
    CREATE TABLE IF NOT EXISTS events (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        button_pressed INTEGER NOT NULL,
        received_at    INTEGER NOT NULL,
        sent_at        INTEGER
    );

    CREATE TABLE IF NOT EXISTS gateway_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
`);

const stmtInsertEvent   = db.prepare('INSERT INTO events (button_pressed, received_at) VALUES (?, ?)');
const stmtGetPending    = db.prepare('SELECT * FROM events WHERE sent_at IS NULL ORDER BY received_at ASC');
const stmtMarkSent      = db.prepare('UPDATE events SET sent_at = ? WHERE id = ?');
const stmtDeleteOldSent = db.prepare('DELETE FROM events WHERE sent_at IS NOT NULL AND sent_at < ?');
const stmtPendingCount  = db.prepare('SELECT COUNT(*) AS cnt FROM events WHERE sent_at IS NULL');
const stmtSentCount     = db.prepare('SELECT COUNT(*) AS cnt FROM events WHERE sent_at IS NOT NULL');
const stmtLastEvent     = db.prepare('SELECT received_at FROM events ORDER BY received_at DESC LIMIT 1');
const stmtGetMeta       = db.prepare('SELECT value FROM gateway_meta WHERE key = ?');
const stmtSetMeta       = db.prepare('INSERT OR REPLACE INTO gateway_meta (key, value) VALUES (?, ?)');

// ── State (for dashboard) ─────────────────────────────────────────────────────

const state = {
    cloudOnline:     false,
    serialConnected: false,
    warningActive:   false,
    lastEventAt:     null,
    lastUploadAt:    null,
    startedAt:       Date.now(),
};

// ── Registration ──────────────────────────────────────────────────────────────
// On first run: use REGISTRATION_CODE from the dashboard to get a token.
// Token is saved in local DB and reused on all subsequent restarts.

async function registerWithCloud() {
    const saved = stmtGetMeta.get('token');
    if (saved) {
        CONFIG.gatewayToken = saved.value;
        console.log('[REGISTER] Loaded saved token from local DB');
        return;
    }

    if (!CONFIG.registrationCode) {
        console.error('[REGISTER] REGISTRATION_CODE is not set.');
        console.error('[REGISTER] Create a device in the SOS IoT dashboard, copy the code, and set REGISTRATION_CODE in .env');
        process.exit(1);
    }

    let firstAttempt = true;
    while (true) {
        try {
            if (firstAttempt) console.log('[REGISTER] Registering with cloud using registration code...');
            const res = await axios.post(
                `${CONFIG.cloudUrl}/api/gateway/register`,
                { registration_code: CONFIG.registrationCode },
                { timeout: 5000 }
            );
            CONFIG.gatewayToken = res.data.token;
            stmtSetMeta.run('token', CONFIG.gatewayToken);
            console.log('[REGISTER] Registration successful — token saved to local DB');
            return;
        } catch (err) {
            const msg = err.response?.data?.error || err.message;
            if (firstAttempt) {
                console.error(`[REGISTER] Failed: ${msg} — will keep retrying`);
                firstAttempt = false;
            }
            await new Promise(r => setTimeout(r, CONFIG.registerRetryMs));
        }
    }
}

// ── Event storage ─────────────────────────────────────────────────────────────

function storeEvent(buttonPressed) {
    stmtInsertEvent.run(buttonPressed, Date.now());
    state.lastEventAt = Date.now();
    console.log(`[EVENT] Stored locally: button_pressed=${buttonPressed}`);
}

// ── Cloud health check ────────────────────────────────────────────────────────

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

// ── Heartbeat ─────────────────────────────────────────────────────────────────

async function heartbeat() {
    if (!CONFIG.gatewayToken) return;
    try {
        await axios.post(
            `${CONFIG.cloudUrl}/api/gateway/ping`,
            {},
            { headers: { 'x-gateway-token': CONFIG.gatewayToken }, timeout: 5000 }
        );
        if (!state.cloudOnline) console.log('[HEARTBEAT] Cloud back online');
        state.cloudOnline = true;
        console.log('[HEARTBEAT] OK');
    } catch (err) {
        if (state.cloudOnline) console.error(`[HEARTBEAT] Cloud offline: ${err.message}`);
        state.cloudOnline = false;
    }
}

// ── Warning ───────────────────────────────────────────────────────────────────
// message = string → set warning; message = null → clear warning.
// Sends only when warning state actually changes to avoid spam.

async function sendWarning(message) {
    if (!CONFIG.gatewayToken) return;
    const isWarning = message !== null;
    if (isWarning  && state.warningActive)  return;
    if (!isWarning && !state.warningActive) return;

    try {
        await axios.post(
            `${CONFIG.cloudUrl}/api/gateway/warning`,
            { message },
            { headers: { 'x-gateway-token': CONFIG.gatewayToken }, timeout: 5000 }
        );
        state.warningActive = isWarning;
        if (isWarning) console.warn(`[WARNING] Set: ${message}`);
        else           console.log('[WARNING] Cleared');
    } catch (err) {
        console.error(`[WARNING] Failed to send: ${err.message}`);
    }
}

// ── Cloud upload ──────────────────────────────────────────────────────────────
// Uploads all pending (unsent) events one by one.
// Stops on first failure and retries on the next interval.

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
                        button_pressed: event.button_pressed,
                        sos_alert:      true,
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
                break; // retry on next interval
            }
        }
    } finally {
        uploading = false;
    }
}

// ── Retention cleanup ─────────────────────────────────────────────────────────

function cleanupSent() {
    const { changes } = stmtDeleteOldSent.run(Date.now() - CONFIG.sentRetentionMs);
    if (changes > 0) console.log(`[CLEANUP] Deleted ${changes} sent event(s) older than retention period`);
}

// ── Serial port ───────────────────────────────────────────────────────────────

const port   = new SerialPort({ path: CONFIG.serialPort, baudRate: CONFIG.baudRate, autoOpen: false });
const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

parser.on('data', (line) => {
    const clean = line.trim();
    console.log(`[SERIAL] ${clean}`);

    if (clean.includes('SOS:BUTTON_PRESS')) {
        const parts = clean.split(':');
        const count = parseInt(parts[3]) || 1;
        storeEvent(count);
        uploadPending().catch(console.error); // upload immediately
    }
});

port.on('error', (err) => {
    state.serialConnected = false;
    console.error('[SERIAL] Error:', err.message);
    sendWarning(`Serial port error: ${err.message}`).catch(console.error);
});

port.on('close', () => {
    state.serialConnected = false;
    console.log('[SERIAL] Port closed — reconnecting in 3 s...');
    sendWarning('IoT node disconnected').catch(console.error);
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
        sendWarning(null).catch(console.error);
        port.set({ dtr: false }, () => setTimeout(() => {
            port.set({ dtr: true }, () => console.log('[SERIAL] HARDWARIO reset complete'));
        }, 100));
    });
}

async function initPort() {
    return new Promise((resolve, reject) => {
        port.open((err) => {
            if (err) { reject(err); return; }
            state.serialConnected = true;
            console.log(`[SERIAL] Connected to ${CONFIG.serialPort}`);
            port.set({ dtr: false }, () => setTimeout(() => {
                port.set({ dtr: true }, () => {
                    console.log('[SERIAL] HARDWARIO reset complete, listening...');
                    resolve();
                });
            }, 100));
        });
    });
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

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
    body  { font-family: monospace; background: #0f0f0f; color: #e0e0e0; padding: 2rem; }
    h1    { color: #ff4444; margin-bottom: 0.5rem; }
    h2    { color: #aaa; font-size: 0.9rem; margin-top: 0; margin-bottom: 2rem; font-weight: normal; }
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
  <h2>Cloud: ${CONFIG.cloudUrl}</h2>
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
    <div class="card">
      <div class="label">Registered</div>
      <div class="value ${CONFIG.gatewayToken ? 'ok' : 'warn'}" style="font-size:1rem">${CONFIG.gatewayToken ? 'YES' : 'PENDING...'}</div>
    </div>
  </div>
  <footer>Auto-refreshes every 10 s &nbsp;|&nbsp; DB: ${CONFIG.dbPath} &nbsp;|&nbsp; Upload: every ${CONFIG.uploadIntervalMs / 1000} s</footer>
</body>
</html>`);
});

app.get('/status', (_req, res) => {
    res.json({
        cloud_url:        CONFIG.cloudUrl,
        cloud_online:     state.cloudOnline,
        serial_connected: state.serialConnected,
        registered:       !!CONFIG.gatewayToken,
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

// ── Graceful shutdown ─────────────────────────────────────────────────────────

process.on('SIGINT', () => {
    console.log('\n[GATEWAY] Shutting down...');
    port.close(() => { db.close(); process.exit(0); });
});

// ── Start ─────────────────────────────────────────────────────────────────────

console.log('╔══════════════════════════════════════╗');
console.log('║   HARDWARIO SOS Gateway              ║');
console.log('╚══════════════════════════════════════╝');
console.log(`Serial:      ${CONFIG.serialPort} @ ${CONFIG.baudRate}`);
console.log(`Cloud:       ${CONFIG.cloudUrl}`);
console.log(`DB:          ${CONFIG.dbPath}`);
console.log(`Upload:      every ${CONFIG.uploadIntervalMs / 1000} s`);
console.log(`Retention:   sent events kept ${CONFIG.sentRetentionMs / 3600000} h`);
console.log(`Dashboard:   http://localhost:${CONFIG.dashboardPort}\n`);

// Retry upload + cleanup timer
setInterval(async () => {
    await uploadPending();
    cleanupSent();
}, CONFIG.uploadIntervalMs);

// Heartbeat timer
setInterval(() => heartbeat().catch(console.error), CONFIG.heartbeatIntervalMs);

// Serial port starts immediately — no cloud required to receive local events
initPort().catch((err) => {
    console.error('[STARTUP] Serial port error:', err.message);
});

// Registration and initial upload — cloud is optional for local operation
registerWithCloud()
    .then(() => {
        heartbeat().catch(console.error);
        uploadPending().catch(console.error);
    })
    .catch((err) => {
        console.error('[STARTUP] Fatal error:', err.message);
        process.exit(1);
    });
