# SOS IoT — Project Documentation

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Components](#2-components)
3. [Data Flow](#3-data-flow)
4. [Firmware — HARDWARIO Device](#4-firmware--hardwario-device)
5. [Gateway — Laptop Bridge](#5-gateway--laptop-bridge)
6. [Backend — Cloud Server](#6-backend--cloud-server)
7. [Frontend — Web Dashboard](#7-frontend--web-dashboard)
8. [Infrastructure — Docker & Caddy](#8-infrastructure--docker--caddy)
9. [Security & Gateway Registration](#9-security--gateway-registration)
10. [Deployment](#10-deployment)
11. [Testing](#11-testing)
12. [Reading the Database](#12-reading-the-database)

---

## 1. System Overview

```
┌─────────────────────┐        USB / Serial (UART)      ┌───────────────────────────┐
│   HARDWARIO Core    │ ─────────────────────────────► │  Gateway (laptop/Docker)  │
│   (IoT Device)      │   115200 baud                   │  gateway/gateway.js       │
│                     │                                  │                           │
│  - SOS button       │                                  │  - Reads Serial port      │
│  - LED indicator    │                                  │  - Buffers events locally │
│  - TMP112 temp.     │                                  │  - SQLite persistence     │
└─────────────────────┘                                  │  - Registers with cloud   │
                                                         └─────────────┬─────────────┘
                                                                       │
                                                          HTTP POST    │ /api/gateway/data
                                                          x-gateway-token: <per-gateway token>
                                                                       │
                                                                       ▼
                                                      ┌────────────────────────────┐
                                                      │   DigitalOcean Droplet     │
                                                      │   209.38.221.215           │
                                                      │                            │
                                                      │   ┌──────────────────────┐ │
                                                      │   │   Caddy  (port 80)   │ │
                                                      │   │   reverse proxy      │ │
                                                      │   └──────────┬───────────┘ │
                                                      │              │              │
                                                      │   /ws  /api/*│  /*          │
                                                      │         ┌────┴────┐         │
                                                      │         │         │         │
                                                      │         ▼         ▼         │
                                                      │   ┌──────────┐ ┌─────────┐  │
                                                      │   │ Backend  │ │Frontend │  │
                                                      │   │ :3001    │ │ :80     │  │
                                                      │   │ Express  │ │ nginx   │  │
                                                      │   │ SQLite   │ │ React   │  │
                                                      │   │ WebSocket│ │         │  │
                                                      │   └──────────┘ └─────────┘  │
                                                      └────────────────────────────┘
                                                                       ▲
                                                             Browser   │  WebSocket (ws://)
                                                         http://209.38.221.215
```

---

## 2. Components

| Component | Runs On | Technologies | File |
|-----------|---------|-------------|------|
| Firmware | HARDWARIO Core Module | C, HARDWARIO SDK | `firmware/src/application.c` |
| Gateway | Laptop (Docker container) | Node.js, serialport, better-sqlite3, axios | `gateway/gateway.js` |
| Backend | Cloud server (Docker) | Node.js, Express, SQLite, ws | `cloud/backend/server.js` |
| Frontend | Browser | React 18, WebSocket API | `cloud/frontend/src/` |
| Reverse Proxy | Cloud server (Docker) | Caddy | `cloud/Caddyfile` |

---

## 3. Data Flow

### SOS Button Press — Full Path

```
1.  User presses the SOS button on the HARDWARIO device

2.  Firmware counts the clicks, toggles the LED, sends over UART:
    "SOS:BUTTON_PRESS:COUNT:3\n"

3.  Gateway reads the line from the Serial port (ReadlineParser)
4.  Gateway parses it: event type = SOS, click count = 3
5.  Gateway writes the event to the local SQLite table events:
    { device_id, button_pressed: 3, received_at: <unix ms>, sent_at: NULL }

6.  Gateway immediately tries to upload the event:
    POST /api/gateway/data
    Headers: { x-gateway-token: <per-gateway token from DB> }
    Body: {
      timestamp, device_id, gateway_id,
      sos_alert: 1,
      button_pressed: 3
    }
    If the cloud is unreachable — event stays in the DB (sent_at = NULL)
    and will be retried every 30 seconds until successful.

7.  Caddy receives the request on port 80, routes /api/* to backend:3001

8.  Backend looks up the token in the gateways table
    → if not found: 401 Unauthorized
    → if found: updates last_seen_at for this gateway

9.  Backend inserts a row into sos_events table

10. Backend broadcasts to all connected WebSocket clients:
    { "type": "sos", "event": { id, timestamp, device_id, button_pressed, gateway_id } }

11. Gateway marks the event as sent (sent_at = now) in local SQLite

12. Browser receives the WebSocket message instantly
13. React prepends the new alert to state — red flashing SOS block appears
    with zero delay, no page refresh needed
```

### Gateway Registration Flow (First Startup)

```
Gateway starts for the first time
  │
  ▼
Check gateway_meta table: is there a saved token?
  │
  ├── YES → load token into CONFIG.gatewayToken, skip to serial init
  │
  └── NO  → POST /api/gateway/register
              Body: { gateway_id, device_id, secret: REGISTRATION_SECRET }
                │
                ▼
              Backend checks: secret === REGISTRATION_SECRET ?
                ├── NO  → 401, gateway retries every 10 seconds
                └── YES → generates token = crypto.randomBytes(32)
                          INSERT INTO gateways(gateway_id, device_id, token, registered_at)
                          returns { token: "a3f9c2...64 chars" }
                │
                ▼
              Gateway saves token to gateway_meta table
              (persists across container restarts via Docker volume)
              │
              ▼
            Subsequent restarts: token loaded from local DB,
            no registration call needed
```

### WebSocket Connection Lifecycle

```
Browser opens http://209.38.221.215
  → React app loads (served by nginx via Caddy)
  → App fetches GET /api/alerts/sos  (historical SOS events for initial load)
  → App polls GET /api/gateways immediately, then every 30 s (gateway last seen)
  → App opens WebSocket: ws://209.38.221.215/ws
       → Caddy proxies /ws to backend:3001 (HTTP upgrade)
       → WebSocket connection established
       → Status indicator shows "Live" (green)

From this point:
  → Every new SOS event is pushed by the server instantly — no polling
  → When a new SOS event arrives, gateway status is also refreshed immediately
  → Disconnect: indicator turns red, reconnects automatically every 3 s
  → Browser goes offline (window 'offline' event): indicator turns red immediately
  → Browser comes back online (window 'online' event): reconnects immediately
```

---

## 4. Firmware — HARDWARIO Device

**File:** `firmware/src/application.c`

The firmware runs on the HARDWARIO Core Module, written in C using the HARDWARIO SDK.

### Initialization

```c
void application_init(void)
```
- Initializes the LED for visual feedback
- Registers the button event handler
- Sets up the TMP112 temperature sensor (I2C)
- Initializes USB CDC to keep the connection with the laptop active

### Button Handler

```c
void button_event_handler(...)
```
- Fires on every button press
- Counts consecutive clicks
- Toggles the LED on each press
- When triggered, sends over UART:
  ```
  SOS:BUTTON_PRESS:COUNT:<N>
  ```

### UART Protocol

| Property | Value |
|----------|-------|
| Baud rate | 115200 |
| Delimiter | `\n` (newline) |
| SOS message | `SOS:BUTTON_PRESS:COUNT:N` |

The gateway only processes lines matching `SOS:BUTTON_PRESS` — any other UART output is ignored.

---

## 5. Gateway — Laptop Bridge

**File:** `gateway/gateway.js`
**Container:** `gateway/Dockerfile` + `gateway/docker-compose.yml`

The gateway is a Node.js process running inside a Docker container on the laptop. It bridges the HARDWARIO device (USB/UART) to the cloud backend.

### Configuration (via `gateway/.env`)

| Variable | Purpose | Default |
|----------|---------|---------|
| `SERIAL_PORT` | USB port of the HARDWARIO device | `/dev/ttyUSB0` |
| `CLOUD_URL` | Backend server address | `http://localhost:3001` |
| `REGISTRATION_SECRET` | Shared secret used to register with the cloud | — |
| `GATEWAY_ID` | Identifier of this gateway instance | `gateway-001` |
| `DEVICE_ID` | Identifier of the HARDWARIO device | `hardwario-001` |
| `DB_PATH` | Path to the SQLite file inside the container | `/data/gateway.db` |
| `DASHBOARD_PORT` | Port for the local gateway dashboard | `8080` |
| `UPLOAD_INTERVAL_MS` | How often to retry uploading pending events | `30000` (30 s) |
| `SENT_RETENTION_MS` | How long to keep sent events before deleting | `86400000` (24 h) |
| `REGISTER_RETRY_MS` | Retry interval if registration fails | `10000` (10 s) |

### Local Database Schema

**Table `events`** — all SOS events received from the device:

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Auto-increment |
| `device_id` | TEXT | Device that sent the event |
| `button_pressed` | INTEGER | Number of button clicks |
| `received_at` | INTEGER | Unix ms timestamp of when event arrived |
| `sent_at` | INTEGER | When it was uploaded to cloud (NULL = pending) |

**Table `gateway_meta`** — key-value store for persistent gateway state:

| key | value |
|-----|-------|
| `token` | Auth token received from the cloud after registration |

### Data Retention Policy

| Data type | Retention |
|-----------|-----------|
| Unsent events (`sent_at IS NULL`) | **Infinite** — never deleted until successfully uploaded |
| Sent events (`sent_at IS NOT NULL`) | **24 hours** — cleaned up automatically |

This guarantees no SOS event is lost due to temporary connectivity issues.
If the cloud is unreachable when the button is pressed, the event is stored locally and uploaded automatically when connectivity is restored.

### Gateway Dashboard

The gateway runs a local web dashboard on port 8080, accessible at `http://localhost:8080`.

It displays:
- Cloud connection status (ONLINE / OFFLINE)
- Serial port connection status (CONNECTED / DISCONNECTED)
- Number of pending records (not yet sent to cloud)
- Number of sent records (within retention window)
- Time of the last SOS event
- Time of the last successful upload
- Gateway uptime

The dashboard auto-refreshes every 10 seconds. A `/status` endpoint returns the same data as JSON.

### Starting the Gateway

```bash
# Build and run with Docker (recommended)
cd gateway
docker compose up -d --build

# View logs
docker compose logs -f

# Stop
docker compose down
```

Expected startup output:
```
╔══════════════════════════════════════╗
║   HARDWARIO SOS Gateway              ║
╚══════════════════════════════════════╝
Serial:      /dev/ttyUSB0 @ 115200
Cloud:       http://209.38.221.215
Device:      hardwario-001
Gateway:     gateway-001
DB:          /data/gateway.db
Upload:      every 30 s
Retention:   sent records kept 24 h
Dashboard:   http://localhost:8080

[SERIAL] Connected to /dev/ttyUSB0
[SERIAL] HARDWARIO reset complete, listening...
[REGISTER] Registering gateway "gateway-001" with cloud...
[REGISTER] Registration successful — token saved to local DB
```

> Serial port and cloud registration start in **parallel** — SOS events are captured and buffered locally from the very first second, even if the cloud is not yet reachable.
>
> If registration fails on first attempt, the error is logged once and retries continue silently every 10 s until the cloud is reachable.

---

## 6. Backend — Cloud Server

**File:** `cloud/backend/server.js`

An Express.js server with a SQLite database and a WebSocket server. Runs inside a Docker container.

### Database Schema

**Table `gateways`** — registered gateway instances:

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Auto-increment primary key |
| `gateway_id` | TEXT | Unique gateway identifier (e.g. `gateway-001`) |
| `device_id` | TEXT | Associated HARDWARIO device ID |
| `token` | TEXT | Unique auth token issued to this gateway |
| `registered_at` | INTEGER | Unix ms timestamp of first registration |
| `last_seen_at` | INTEGER | Unix ms timestamp of last data upload |

**Table `sos_events`** — stores every SOS alert received from any gateway:

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Auto-increment primary key |
| `timestamp` | INTEGER | Unix ms timestamp from the device |
| `device_id` | TEXT | Device that triggered the alert |
| `button_pressed` | INTEGER | Number of button clicks in this event |
| `gateway_id` | TEXT | Gateway that forwarded the event |
| `synced_at` | INTEGER | Server time when the record was inserted |

### API Endpoints

| Method | URL | Description | Auth |
|--------|-----|-------------|------|
| `GET` | `/` | Health check + active WebSocket client count | No |
| `POST` | `/api/gateway/register` | Register a new gateway, receive unique token | Registration secret |
| `POST` | `/api/gateway/data` | Receive SOS event data from a gateway | Per-gateway token |
| `GET` | `/api/alerts/sos` | Get full SOS event history | No |
| `GET` | `/api/gateways` | List all registered gateways and their last seen time | No |

### POST /api/gateway/register

Request body:
```json
{
  "gateway_id": "gateway-001",
  "device_id":  "hardwario-001",
  "secret":     "<REGISTRATION_SECRET>"
}
```

Response `201`:
```json
{ "token": "a3f9c2d1...64 hex chars" }
```

The token is unique per gateway and stored in the `gateways` table. The gateway must store it locally and use it in all subsequent `POST /api/gateway/data` calls.

### POST /api/gateway/data

Request headers:
```
x-gateway-token: <token received after registration>
```

Request body:
```json
{
  "timestamp":      1700000000000,
  "device_id":      "hardwario-001",
  "gateway_id":     "gateway-001",
  "sos_alert":      1,
  "button_pressed": 3
}
```

If `sos_alert !== 1`, the record is acknowledged but not stored.

### WebSocket

The WebSocket server runs on the same HTTP server as Express, on path `/ws`.

```
ws://209.38.221.215/ws
```

When a new SOS event arrives, the backend calls `broadcast()` which sends to all connected browsers:

```json
{ "type": "sos", "event": { "id": 42, "timestamp": 1700000000000, "device_id": "hardwario-001", "button_pressed": 3, "gateway_id": "gateway-001" } }
```

### Data Persistence

The SQLite file is stored at `/app/data/gateway_data.db` inside the container.
It persists across container restarts via the Docker volume `sqlite-data`.

> **Note:** `docker compose down -v` will erase all data including SOS history and registered gateways.

---

## 7. Frontend — Web Dashboard

**Folder:** `cloud/frontend/src/`

A React 18 application compiled to static files and served by nginx.

### Component Tree

```
App.js
├── connects to WebSocket on mount (auto-reconnects every 3 s on drop)
├── fetches SOS history via GET /api/alerts/sos on mount
├── SOSAlert.jsx     — red flashing block only for alerts < 5 min old;
│                      header shows "X total, Y recent"; last 5 events always visible
└── Dashboard.jsx    — stats cards (total events, active devices)
                       + event log table (last 20 alerts)
```

### Real-time Updates

On mount, the app opens a persistent WebSocket connection with automatic reconnect:

```js
function connect() {
    const ws = new WebSocket(`ws://${window.location.host}/ws`);
    ws.onopen  = () => setWsConnected(true);
    ws.onclose = () => { setWsConnected(false); setTimeout(connect, 3000); };
    ws.onmessage = (e) => {
        try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'sos') {
                setAlerts(prev => [msg.event, ...prev]);
                pollGateway(); // refresh gateway "last seen" immediately
            }
        } catch (err) {
            console.error('[WS] Failed to parse message:', err);
        }
    };
}
window.addEventListener('offline', () => { setWsConnected(false); ws.close(); });
window.addEventListener('online',  () => connect());
```

Status indicators (header):
| Indicator | Green | Red |
|-----------|-------|-----|
| **Live** | WebSocket connected — events arrive instantly | Dropped — reconnecting every 3 s |
| **Gateway: Xm ago** | Gateway sent data within last 5 minutes | Last seen more than 5 minutes ago |

Gateway status is polled every 30 seconds and also refreshed immediately when a new SOS event arrives via WebSocket.

### SOSAlert — Recent vs Historical

The component distinguishes between recent and historical alerts:

| State | Condition | Visual |
|-------|-----------|--------|
| `has-alerts` (red) | At least one alert within the last 5 minutes | Red flashing section |
| `no-alerts` (neutral) | All alerts older than 5 minutes | Neutral section with history |

The last 5 alerts are always shown in the list regardless of age.

### Build Process

```
npm run build  →  /app/build/  →  copied to nginx /usr/share/nginx/html
```

The React app is compiled once during `docker compose build`. To apply frontend changes, rebuild with `docker compose up -d --build`.

---

## 8. Infrastructure — Docker & Caddy

### Docker Compose Services

**File:** `cloud/docker-compose.yml`

```
caddy      → exposes ports 80, 443 — sole public entry point
backend    → internal port 3001 only
frontend   → internal port 80 only
```

All three containers run on the internal Docker network `cloud_default`. Nothing except Caddy is reachable from outside the host.

**File:** `gateway/docker-compose.yml`

```
gateway    → exposes port 8080 (local dashboard)
             mounts /dev/ttyUSB0 for USB serial access
             volume gateway-sqlite for SQLite persistence
```

### Caddy Routing

**File:** `cloud/Caddyfile`

```
:80 {
    handle /ws     → reverse_proxy backend:3001  (WebSocket upgrade)
    handle /api/*  → reverse_proxy backend:3001  (REST API)
    handle /*      → reverse_proxy frontend:80   (React SPA)
}
```

| Request | Path | Goes to |
|---------|------|---------|
| Browser opens dashboard | `/*` | nginx → React SPA |
| React fetches history | `/api/alerts/sos` | Express backend |
| Gateway registers | `/api/gateway/register` | Express backend |
| Gateway posts data | `/api/gateway/data` | Express backend |
| WebSocket connection | `/ws` | WebSocket server |

### Volumes

| Volume | Where | Purpose |
|--------|-------|---------|
| `sqlite-data` | Cloud backend | SOS events database (`/app/data/`) |
| `gateway-sqlite` | Gateway | Local buffer + meta (`/data/`) |
| `caddy_data` | Caddy | TLS certificates |
| `caddy_config` | Caddy | Internal Caddy config |

### Auto-restart Policy

All containers use `restart: unless-stopped`. This means:
- They start automatically when Docker starts (i.e. when the machine boots, if Docker is set to auto-start)
- They restart automatically if they crash
- They only stay stopped if explicitly stopped with `docker compose down`

---

## 9. Security & Gateway Registration

### Registration Model

Each gateway must register itself with the cloud before it can send data.

| What | How |
|------|-----|
| **Authentication for registration** | `REGISTRATION_SECRET` — shared password in `.env` on both sides |
| **Authentication for data upload** | Per-gateway token issued by cloud after registration |
| **Token storage (cloud)** | `gateways` table in SQLite |
| **Token storage (gateway)** | `gateway_meta` table in local SQLite |

A gateway that loses its local DB (e.g. volume deleted) re-registers automatically and receives a new token.

### What Is Protected

| Endpoint | Protection |
|----------|-----------|
| `POST /api/gateway/register` | `REGISTRATION_SECRET` required in body |
| `POST /api/gateway/data` | Per-gateway token required in `x-gateway-token` header |
| `GET /api/alerts/sos` | Open — anyone can read history |
| `GET /api/gateways` | Open — anyone can see registered gateways |
| `GET /ws` | Open — anyone can connect and watch live alerts |

### Token Validation (Data Upload)

```js
// Backend: look up token in DB, reject if not found
db.get('SELECT * FROM gateways WHERE token = ?', [incomingToken], (err, gateway) => {
    if (!gateway) return res.status(401).json({ error: 'Unauthorized — gateway not registered' });
    db.run('UPDATE gateways SET last_seen_at = ? WHERE id = ?', [Date.now(), gateway.id]);
    // ... process data
});
```

### Token Storage

- **Cloud:** `REGISTRATION_SECRET` in `/home/deploy/sos-iot/cloud/backend/.env` → loaded via docker-compose `env_file: ./backend/.env`
- **Gateway:** `REGISTRATION_SECRET` in `gateway/.env` → loaded by `dotenv`; received token stored in SQLite `gateway_meta`
- **Git:** Both `.env` files are in `.gitignore` — secrets are never committed

### Current Risks

| Risk | Severity | Cause |
|------|----------|-------|
| Data sent over plain HTTP | High | No HTTPS — token can be intercepted on the network |
| SOS history publicly readable | Low | `GET /api/alerts/sos` has no auth |
| Anyone can watch live alerts | Low | WebSocket `/ws` has no auth |
| No rate limiting | Medium | POST endpoints can be spammed |

### Recommended Hardening (Production)

**1. Add HTTPS** — the most important fix. With a domain name, Caddy handles TLS automatically:
```
yourdomain.com {
    handle /ws     { reverse_proxy backend:3001 }
    handle /api/*  { reverse_proxy backend:3001 }
    handle /*      { reverse_proxy frontend:80  }
}
```
This also upgrades WebSocket to `wss://` automatically.

**2. Firewall on the droplet:**
```bash
ufw allow 22    # SSH
ufw allow 80    # HTTP
ufw allow 443   # HTTPS
ufw enable
```

**3. Rate limiting** — add `express-rate-limit` to the POST endpoints.

---

## 10. Deployment

### Cloud — First Deploy

```bash
# 1. Install Docker on the server
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# 2. Copy cloud/ directory to the server
scp -r cloud/ deploy@209.38.221.215:/home/deploy/sos-iot/

# 3. Create .env for the backend on the server
ssh deploy@209.38.221.215
echo "REGISTRATION_SECRET=your-strong-secret-here" > /home/deploy/sos-iot/cloud/backend/.env

# 4. Start all services
cd /home/deploy/sos-iot/cloud
docker compose up -d --build
```

### Gateway — First Run

```bash
# 1. Create gateway/.env on the laptop
cp gateway/.env.example gateway/.env
# Edit .env: set SERIAL_PORT, CLOUD_URL, REGISTRATION_SECRET, GATEWAY_ID, DEVICE_ID

# 2. Start the gateway container
cd gateway
docker compose up -d --build

# The gateway will:
#   a) register with cloud on first startup → receive and save token
#   b) connect to the HARDWARIO device via USB
#   c) start buffering and uploading data
```

### Cloud — Update After Code Changes

```bash
# Copy changed files
scp -r cloud/backend deploy@209.38.221.215:/home/deploy/sos-iot/cloud/
scp -r cloud/frontend/src deploy@209.38.221.215:/home/deploy/sos-iot/cloud/frontend/

# Rebuild and restart on server
ssh deploy@209.38.221.215
cd /home/deploy/sos-iot/cloud
docker compose up -d --build
```

### Reset the Cloud Database

```bash
cd /home/deploy/sos-iot/cloud
docker compose down -v        # removes all volumes — deletes SOS history AND registered gateways
docker compose up -d --build  # fresh start
```

> After this, all gateways will need to re-register. Their local `gateway_meta` token will fail validation → gateway retries registration automatically.

### Reset the Gateway Database

```bash
cd gateway
docker compose down -v        # removes gateway-sqlite volume
docker compose up -d --build  # gateway will re-register on next startup
```

### Useful Commands

```bash
# Check container status
docker compose ps

# Stream all logs
docker compose logs -f

# Logs for one service
docker compose logs -f backend

# Restart a single service
docker compose restart caddy

# Stop everything (keeps volumes)
docker compose down

# Stop and delete all data
docker compose down -v
```

---

## 11. Testing

### Test API authentication with curl

**POST /api/gateway/data — wrong token → 401:**
```bash
curl -X POST http://209.38.221.215/api/gateway/data \
  -H "Content-Type: application/json" \
  -H "x-gateway-token: wrongtoken" \
  -d '{"timestamp":1700000000000,"device_id":"test","gateway_id":"gw-001","sos_alert":1,"button_pressed":1}'
# Expected: {"error":"Unauthorized — gateway not registered"}
```

**POST /api/gateway/data — no token → 401:**
```bash
curl -X POST http://209.38.221.215/api/gateway/data \
  -H "Content-Type: application/json" \
  -d '{"timestamp":1700000000000,"device_id":"test","gateway_id":"gw-001","sos_alert":1,"button_pressed":1}'
# Expected: {"error":"Unauthorized — gateway not registered"}
```

**POST /api/gateway/register — wrong secret → 401:**
```bash
curl -X POST http://209.38.221.215/api/gateway/register \
  -H "Content-Type: application/json" \
  -d '{"gateway_id":"test-gw","device_id":"test-device","secret":"wrongsecret"}'
# Expected: {"error":"Forbidden"}
```

**GET /api/alerts/sos — read event history:**
```bash
curl http://209.38.221.215/api/alerts/sos
```

**GET /api/gateways — list registered gateways:**
```bash
curl http://209.38.221.215/api/gateways
```

**GET / — backend health check:**
```bash
curl http://209.38.221.215/api/
```

---

## 12. Reading the Database

### On the server (cloud backend)

```bash
ssh deploy@209.38.221.215

# Enter the backend container
docker exec -it sos-backend sh

# Open the database
sqlite3 /app/data/gateway_data.db

# Useful queries:
.tables
SELECT * FROM sos_events ORDER BY timestamp DESC LIMIT 20;
SELECT * FROM gateways;
SELECT COUNT(*) FROM sos_events;
.quit
```

Or without entering the container:
```bash
docker exec sos-backend sqlite3 /app/data/gateway_data.db "SELECT * FROM sos_events ORDER BY timestamp DESC LIMIT 10;"
```

### On the gateway (local laptop)

```bash
# Enter the gateway container
docker exec -it sos-gateway sh

sqlite3 /data/gateway.db

# Useful queries:
.tables
SELECT * FROM events ORDER BY received_at DESC LIMIT 20;
SELECT * FROM events WHERE sent_at IS NULL;   -- pending (not yet uploaded)
SELECT * FROM gateway_meta;                   -- saved auth token
.quit
```

Or without entering the container:
```bash
docker exec sos-gateway sqlite3 /data/gateway.db "SELECT id, device_id, button_pressed, datetime(received_at/1000,'unixepoch') as time, sent_at FROM events ORDER BY received_at DESC LIMIT 10;"
```
