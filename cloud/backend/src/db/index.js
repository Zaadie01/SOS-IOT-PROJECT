const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const { initSchema }     = require('./schema');
const { startCleanupJob } = require('./cleanup');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'gateway_data.db'));

// 1. Schema is guaranteed to exist before the HTTP server accepts any request
initSchema(db);

// 2. Cleanup job starts only after the schema is ready
startCleanupJob(db);

module.exports = db;
