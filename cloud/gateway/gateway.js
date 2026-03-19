// gateway.js - Serial port gateway between HARDWARIO device and cloud backend
require('dotenv').config();

const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const axios = require('axios');

// Configuration
const CONFIG = {
    serialPort: process.env.SERIAL_PORT || 'COM4',
    baudRate: 115200,
    cloudUrl: process.env.CLOUD_URL || 'http://localhost:3001',
    gatewayId: process.env.GATEWAY_ID || 'gateway-001',
    deviceId: process.env.DEVICE_ID || 'hardwario-001',
    gatewayToken: process.env.GATEWAY_TOKEN || '',
    retryAttempts: 3,
    retryDelay: 2000,
};

// Initialize serial port
const port = new SerialPort({
    path: CONFIG.serialPort,
    baudRate: CONFIG.baudRate,
    autoOpen: false,
});

const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

// Send data to cloud backend with retry logic
async function sendToCloud(payload, attempt = 1) {
    try {
        const response = await axios.post(`${CONFIG.cloudUrl}/api/gateway/data`, payload, {
            headers: {
                'Content-Type': 'application/json',
                'x-gateway-token': CONFIG.gatewayToken,
            },
            timeout: 5000,
        });

        console.log(`[CLOUD] Success:`, response.data);
        return true;

    } catch (error) {
        console.error(`[CLOUD] Error:`, error.message);

        if (attempt < CONFIG.retryAttempts) {
            console.log(`[CLOUD] Retrying in ${CONFIG.retryDelay}ms...`);
            await sleep(CONFIG.retryDelay);
            return sendToCloud(payload, attempt + 1);
        } else {
            console.error(`[CLOUD] Failed after ${CONFIG.retryAttempts} attempts`);
            return false;
        }
    }
}

// Parse incoming serial data from HARDWARIO
function handleSerialData(line) {
    const clean = line.trim();

    console.log(`[SERIAL] ${clean}`);

    // Parse format: SOS:BUTTON_PRESS:COUNT:5
    if (clean.includes('SOS:BUTTON_PRESS')) {
        const parts = clean.split(':');
        const count = parts[3] ? parseInt(parts[3]) : 1;

        console.log(`[EVENT] SOS ALERT! Click count: ${count}`);

        const payload = {
            timestamp: Date.now(),
            device_id: CONFIG.deviceId,
            gateway_id: CONFIG.gatewayId,
            sos_alert: 1,
            button_pressed: count,
        };

        sendToCloud(payload);
    }
}

// Initialize port with HARDWARIO reset
async function initPort() {
    return new Promise((resolve, reject) => {
        port.open((err) => {
            if (err) {
                reject(err);
                return;
            }

            console.log(`[SERIAL] Connected to ${CONFIG.serialPort}`);
            console.log('[SERIAL] Resetting HARDWARIO...');

            // DTR toggle to reset device
            port.set({ dtr: false }, () => {
                setTimeout(() => {
                    port.set({ dtr: true }, () => {
                        console.log('[SERIAL] HARDWARIO reset complete, waiting for events...');
                        resolve();
                    });
                }, 100);
            });
        });
    });
}

// Event handlers
port.on('error', (err) => {
    console.error('[SERIAL] Error:', err.message);
    console.log('\nTroubleshooting:');
    console.log('  1. Check COM port: change SERIAL_PORT env or CONFIG.serialPort');
    console.log('  2. Verify HARDWARIO is connected via USB');
    console.log('  3. Close HARDWARIO Code (especially Attach Console)');
    console.log('\nFind ports: npx @serialport/list\n');
});

parser.on('data', handleSerialData);

// Utility functions
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[GATEWAY] Shutting down...');
    port.close(() => {
        console.log('[SERIAL] Port closed');
        process.exit(0);
    });
});

console.log('HARDWARIO SOS Gateway Started');
console.log(`Serial:  ${CONFIG.serialPort} @ ${CONFIG.baudRate}`);
console.log(`Cloud:   ${CONFIG.cloudUrl}`);
console.log(`Device:  ${CONFIG.deviceId}`);
console.log(`Gateway: ${CONFIG.gatewayId}\n`);

// Start
initPort().catch((err) => {
    console.error('[SERIAL] Connection failed:', err.message);
    process.exit(1);
});
