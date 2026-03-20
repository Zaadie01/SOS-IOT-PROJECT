// gateway.js - Serial gateway with SQLite persistence, downsampling, dashboard
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
    gatewayToken:       process.env.GATEWAY_TOKEN        || '',
    dbPath:             process.env.DB_PATH              || '/data/gateway.db',
    dashboardPort:      parseInt(process.env.DASHBOARD_PORT) || 8080,
    // Downsampling: aggregate raw events into 5-minute buckets.
    // Strategy: arithmetic mean of button_pressed per event in the bucket.
    // Justification: mean represents average urgency intensity per activation.
    // Combined with sos_count (total activations) it gives a full picture.
    downsampleWindowMs: parseInt(process.env.DOWNSAMPLE_WINDOW_MS) || 5 * 60 * 1000,
    // How often to attempt upload of pending records to cloud
    uploadIntervalMs:   parseInt(process.env.UPLOAD_INTERVAL_MS)   || 30 * 1000,
    // Sent records are deleted after this retention period (24 h).
    // Unsent records are never deleted — infinite retention until uploaded.
    sentRetentionMs:    parseInt(process.env.SENT_RETENTION_MS)    || 24 * 60 * 60 * 1000,
};

// ---------------------------------------------------------------------------
// SQLite setup
// ---------------------------------------------------------------------------

const db = new Database(CONFIG.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
    CREATE TABLE IF NOT EXISTS raw_buffer (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id      TEXT    NOT NULL,
        button_pressed INTEGER NOT NULL,
        received_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS downsampled (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id     TEXT    NOT NULL,
        gateway_id    TEXT    NOT NULL,
        bucket_start  INTEGER NOT NULL,
        bucket_end    INTEGER NOT NULL,
        sos_count     INTEGER NOT NULL,
        button_mean   REAL    NOT NULL,
        created_at    INTEGER NOT NULL,
        sent_at       INTEGER,
        UNIQUE(device_id, bucket_start)
    );
`);

const stmtInsertRaw = db.prepare(
    'INSERT INTO raw_buffer (device_id, button_pressed, received_at) VALUES (?, ?, ?)'
);
const stmtGetRaw = db.prepare(
    'SELECT button_pressed FROM raw_buffer WHERE device_id = ? AND received_at >= ? AND received_at < ?'
);
const stmtDeleteRaw = db.prepare(
    'DELETE FROM raw_buffer WHERE device_id = ? AND received_at < ?'
);
const stmtInsertDownsampled = db.prepare(`
    INSERT OR REPLACE INTO downsampled
        (device_id, gateway_id, bucket_start, bucket_end, sos_count, button_mean, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const stmtGetPending = db.prepare(
    'SELECT * FROM downsampled WHERE sent_at IS NULL ORDER BY bucket_start ASC'
);
const stmtMarkSent = db.prepare(
    'UPDATE downsampled SET sent_at = ? WHERE id = ?'
);
const stmtDeleteOldSent = db.prepare(
    'DELETE FROM downsampled WHERE sent_at IS NOT NULL AND sent_at < ?'
);
const stmtPendingCount = db.prepare(
    'SELECT COUNT(*) as cnt FROM downsampled WHERE sent_at IS NULL'
);
const stmtSentCount = db.prepare(
    'SELECT COUNT(*) as cnt FROM downsampled WHERE sent_at IS NOT NULL'
);
const stmtLastEvent = db.prepare(
    'SELECT bucket_end FROM downsampled ORDER BY bucket_end DESC LIMIT 1'
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
// Raw event ingestion
// ---------------------------------------------------------------------------

function bufferEvent(deviceId, buttonPressed) {
    stmtInsertRaw.run(deviceId, buttonPressed, Date.now());
    state.lastEventAt = Date.now();
    console.log(`[BUFFER] Stored raw: device=${deviceId} count=${buttonPressed}`);
}

// ---------------------------------------------------------------------------
// Downsampling — arithmetic mean over 5-minute buckets
// ---------------------------------------------------------------------------

let bucketStart = Math.floor(Date.now() / CONFIG.downsampleWindowMs) * CONFIG.downsampleWindowMs;

function flushBucket() {
    const bucketEnd = Date.now();
    const rows = stmtGetRaw.all(CONFIG.deviceId, bucketStart, bucketEnd);

    if (rows.length === 0) {
        bucketStart = bucketEnd;
        return;
    }

    const sosCount   = rows.length;
    const buttonSum  = rows.reduce((s, r) => s + r.button_pressed, 0);
    const buttonMean = buttonSum / sosCount;

    stmtInsertDownsampled.run(
        CONFIG.deviceId, CONFIG.gatewayId,
        bucketStart, bucketEnd,
        sosCount, buttonMean, Date.now()
    );
    stmtDeleteRaw.run(CONFIG.deviceId, bucketEnd);

    console.log(
        `[DOWNSAMPLE] Bucket [${new Date(bucketStart).toISOString()} – ${new Date(bucketEnd).toISOString()}]` +
        ` events=${sosCount} mean_clicks=${buttonMean.toFixed(2)}`
    );

    bucketStart = bucketEnd;
}

// ---------------------------------------------------------------------------
// Cloud upload
// ---------------------------------------------------------------------------

async function uploadPending() {
    const pending = stmtGetPending.all();
    if (pending.length === 0) return;

    console.log(`[UPLOAD] ${pending.length} record(s) pending`);

    for (const rec of pending) {
        try {
            await axios.post(
                `${CONFIG.cloudUrl}/api/gateway/data`,
                {
                    timestamp:      rec.bucket_end,
                    device_id:      rec.device_id,
                    gateway_id:     rec.gateway_id,
                    sos_alert:      rec.sos_count > 0 ? 1 : 0,
                    button_pressed: Math.round(rec.button_mean),
                    sos_count:      rec.sos_count,
                    button_mean:    rec.button_mean,
                    bucket_start:   rec.bucket_start,
                    bucket_end:     rec.bucket_end,
                },
                {
                    headers: {
                        'Content-Type':    'application/json',
                        'x-gateway-token': CONFIG.gatewayToken,
                    },
                    timeout: 5000,
                }
            );
            stmtMarkSent.run(Date.now(), rec.id);
            state.cloudOnline  = true;
            state.lastUploadAt = Date.now();
            console.log(`[UPLOAD] Sent record id=${rec.id}`);
        } catch (err) {
            state.cloudOnline = false;
            console.error(`[UPLOAD] Failed record id=${rec.id}: ${err.message}`);
        }
    }
}

// ---------------------------------------------------------------------------
// Retention cleanup — delete sent records older than 24 h
// ---------------------------------------------------------------------------

function cleanupSent() {
    const { changes } = stmtDeleteOldSent.run(Date.now() - CONFIG.sentRetentionMs);
    if (changes > 0) console.log(`[CLEANUP] Deleted ${changes} sent record(s) older than 24 h`);
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
        const count = parts[3] ? parseInt(parts[3]) : 1;
        console.log(`[EVENT] SOS! clicks=${count}`);
        bufferEvent(CONFIG.deviceId, count);
        // Flush and upload immediately — don't wait for the 5-min timer
        flushBucket();
        uploadPending().catch(console.error);
    }
});

port.on('error', (err) => {
    state.serialConnected = false;
    console.error('[SERIAL] Error:', err.message);
});

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
    const pending  = stmtPendingCount.get().cnt;
    const sent     = stmtSentCount.get().cnt;
    const lastRow  = stmtLastEvent.get();
    const lastEvent = lastRow ? new Date(lastRow.bucket_end).toLocaleString() : 'none';
    const uptime   = Math.floor((Date.now() - state.startedAt) / 1000);

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
        pending_records:  stmtPendingCount.get().cnt,
        sent_records:     stmtSentCount.get().cnt,
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
    console.log('\n[GATEWAY] Shutting down — flushing buffer...');
    flushBucket();
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
console.log(`Downsample:  every ${CONFIG.downsampleWindowMs / 60000} min — arithmetic mean`);
console.log(`Upload:      every ${CONFIG.uploadIntervalMs / 1000} s`);
console.log(`Retention:   sent records kept ${CONFIG.sentRetentionMs / 3600000} h`);
console.log(`Dashboard:   http://localhost:${CONFIG.dashboardPort}\n`);

// Downsampling timer — every 5 minutes
setInterval(flushBucket, CONFIG.downsampleWindowMs);

// Upload + cleanup timer — every 30 s
setInterval(async () => {
    await uploadPending();
    cleanupSent();
}, CONFIG.uploadIntervalMs);

// Upload any records left from a previous run immediately
uploadPending().catch(console.error);

// Connect to serial device
initPort().catch((err) => {
    console.error('[SERIAL] Connection failed:', err.message);
    process.exit(1);
});
