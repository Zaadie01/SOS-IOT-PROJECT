PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('SOS', 'FALL')),
  temp_c REAL,
  accel_x_g REAL,
  accel_y_g REAL,
  accel_z_g REAL,
  raw_payload TEXT,
  synced INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS heartbeats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  temp_c REAL,
  accel_x_g REAL,
  accel_y_g REAL,
  accel_z_g REAL,
  battery_pct REAL,
  raw_payload TEXT,
  synced INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alerts_device_time ON alerts(device_id, timestamp_ms DESC);
CREATE INDEX IF NOT EXISTS idx_heartbeats_device_time ON heartbeats(device_id, timestamp_ms DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_unsynced ON alerts(synced);
CREATE INDEX IF NOT EXISTS idx_heartbeats_unsynced ON heartbeats(synced);
