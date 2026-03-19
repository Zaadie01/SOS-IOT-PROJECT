# SOS IoT — Architecture & How It Works

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Components](#2-components)
3. [Data Flow](#3-data-flow)
4. [Firmware — HARDWARIO Device](#4-firmware--hardwario-device)
5. [Gateway — Laptop Bridge](#5-gateway--laptop-bridge)
6. [Backend — Cloud Server](#6-backend--cloud-server)
7. [Frontend — Web Dashboard](#7-frontend--web-dashboard)
8. [Infrastructure — Docker & Caddy](#8-infrastructure--docker--caddy)
9. [Security](#9-security)
10. [Deployment](#10-deployment)

---

## 1. System Overview

```
┌─────────────────────┐        USB / Serial         ┌──────────────────────┐
│   HARDWARIO Core    │ ──────────────────────────► │  Gateway (laptop)    │
│   (IoT Device)      │   115200 baud, UART          │  gateway.js          │
│                     │                              │                      │
│  - SOS button       │                              │  - Reads Serial port │
│  - LED indicator    │                              │  - Parses UART data  │
└─────────────────────┘                              └──────────┬───────────┘
                                                                │
                                                       HTTP POST│ /api/gateway/data
                                                       x-gateway-token: <secret>
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
| Firmware | HARDWARIO device | C, HARDWARIO SDK | `firmware/src/application.c` |
| Gateway | Laptop (Windows) | Node.js, serialport, axios | `cloud/gateway/gateway.js` |
| Backend | Cloud server | Node.js, Express, SQLite, ws | `cloud/backend/server.js` |
| Frontend | Browser | React, WebSocket API | `cloud/frontend/src/` |
| Reverse Proxy | Cloud server | Caddy | `cloud/Caddyfile` |

---

## 3. Data Flow

### SOS Button Press

```
1. User presses the SOS button on the HARDWARIO device

2. Firmware counts the clicks and sends over UART:
   "SOS:BUTTON_PRESS:COUNT:3\n"

3. Gateway reads the line from the Serial port
4. Gateway parses it: event type = SOS, click count = 3
5. Gateway builds a JSON payload:
   {
     "timestamp": 1700000000,
     "device_id": "hardwario-001",
     "gateway_id": "gateway-001",
     "sos_alert": 1,
     "button_pressed": 3
   }

6. Gateway sends POST /api/gateway/data to the server
   with header: x-gateway-token: <secret token>

7. Caddy receives the request on port 80, routes /api/* to backend:3001

8. Backend checks the token — rejects with 401 if invalid

9. Backend inserts a row into the sos_events SQLite table

10. Backend broadcasts the event to all connected WebSocket clients:
    { "type": "sos", "event": { id, timestamp, device_id, button_pressed, gateway_id } }

11. Browser receives the WebSocket message instantly
12. React prepends the new alert to state — red flashing SOS block appears
    with zero delay, no page refresh needed
```

### WebSocket Connection Lifecycle

```
Browser opens http://209.38.221.215
  → React app loads (served by nginx via Caddy)
  → App fetches GET /api/alerts/sos  (historical SOS events for initial load)
  → App opens WebSocket: ws://209.38.221.215/ws
       → Caddy proxies /ws to backend:3001 (automatic HTTP upgrade)
       → WebSocket connection established
       → Status indicator shows "Live"

From this point:
  → Every new SOS event is pushed by the server to the browser instantly
  → No polling — connection stays open permanently
```

---

## 4. Firmware — HARDWARIO Device

**File:** `firmware/src/application.c`

The firmware is written in C using the HARDWARIO SDK. It runs on the HARDWARIO Core Module.

### Initialization
```c
void application_init(void)
```
- Initializes the LED for visual feedback
- Registers the button event handler
- Sets up the TMP112 temperature sensor (I2C)

### Button Handler
```c
void button_event_handler(...)
```
- Fires on every button press
- Counts consecutive clicks
- When the threshold is reached, sends over UART:
  ```
  SOS:BUTTON_PRESS:COUNT:<N>
  ```

### UART Protocol
- Baud rate: **115200**
- Each message ends with `\n`
- SOS format: `SOS:BUTTON_PRESS:COUNT:N`

The gateway only processes lines matching `SOS:BUTTON_PRESS` — any other UART output is ignored.

---

## 5. Gateway — Laptop Bridge

**File:** `cloud/gateway/gateway.js`

The gateway is a Node.js process running on the laptop connected to the HARDWARIO device via USB.

### Configuration (via `.env`)

| Variable | Purpose | Default |
|----------|---------|---------|
| `SERIAL_PORT` | COM port of the HARDWARIO device | `COM4` |
| `CLOUD_URL` | Server address | `http://localhost:3001` |
| `GATEWAY_TOKEN` | Auth token for the backend | empty |
| `GATEWAY_ID` | Identifier of this gateway instance | `gateway-001` |
| `DEVICE_ID` | Identifier of the HARDWARIO device | `hardwario-001` |

### How It Works

1. Opens the Serial port at 115200 baud
2. Toggles DTR to reset the HARDWARIO device on startup
3. Listens for lines via `ReadlineParser` (splits on `\n`)
4. On each line — checks if it matches `SOS:BUTTON_PRESS`
5. Builds a JSON payload and sends it via HTTP POST with retry logic:
   - 3 attempts
   - 2 second delay between retries
   - 5 second request timeout

### Running the Gateway

```powershell
cd cloud/gateway
npm install
npm install dotenv

# Configure environment
copy .env.example .env
# Edit: SERIAL_PORT, CLOUD_URL, GATEWAY_TOKEN

node -r dotenv/config gateway.js
```

Expected output:
```
HARDWARIO SOS Gateway Started
Serial:  COM4 @ 115200
Cloud:   http://209.38.221.215
Device:  hardwario-001
Gateway: gateway-001
```

---

## 6. Backend — Cloud Server

**File:** `cloud/backend/server.js`

An Express.js server with a SQLite database and a WebSocket server. Runs inside a Docker container.

### Database Schema

**Table `sos_events`** — stores every SOS alert:

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Auto-increment primary key |
| `timestamp` | INTEGER | Unix timestamp from the device |
| `device_id` | TEXT | Device identifier |
| `button_pressed` | INTEGER | Number of button clicks in this event |
| `gateway_id` | TEXT | Gateway that forwarded the event |
| `synced_at` | INTEGER | Server time when the record was inserted |

### API Endpoints

| Method | URL | Description | Auth |
|--------|-----|-------------|------|
| `GET` | `/` | Health check + WS client count | No |
| `POST` | `/api/gateway/data` | Receive SOS event from gateway | Token |
| `GET` | `/api/alerts/sos` | Get full SOS history | No |

### WebSocket

The WebSocket server runs on the same HTTP server as Express, on path `/ws`.

```
ws://209.38.221.215/ws
```

When a new SOS event arrives via `POST /api/gateway/data`, the backend calls `broadcast()` which sends the event JSON to every currently connected browser client.

```js
broadcast({ type: 'sos', event: { id, timestamp, device_id, button_pressed, gateway_id } });
```

### Data Persistence

The SQLite file is stored at `/app/data/gateway_data.db` inside the container.
It persists across container restarts via the Docker volume `sqlite-data`.

> **Note:** Dropping the `sqlite-data` volume will erase all history.
> Do this intentionally with: `docker compose down -v`

---

## 7. Frontend — Web Dashboard

**Folder:** `cloud/frontend/src/`

A React application, compiled to static files and served by nginx.

### Component Tree

```
App.js
├── connects to WebSocket on mount
├── fetches SOS history via GET /api/alerts/sos on mount
├── SOSAlert.jsx     — red flashing block when alerts exist, grey when clear
└── Dashboard.jsx    — stats cards + event log table
```

### Real-time Updates (WebSocket)

On mount, the app opens a persistent WebSocket connection:
```js
const ws = new WebSocket(`ws://${window.location.host}/ws`);

ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'sos') {
        setAlerts(prev => [msg.event, ...prev]);  // prepend to list instantly
    }
};
```

The status indicator in the header shows:
- **Live** (green) — WebSocket connected, events arrive instantly
- **Disconnected** (red) — WebSocket dropped, no real-time updates

### Initial Data Load

On first render, the app fetches `GET /api/alerts/sos` to populate the historical event list. After that, only WebSocket events update the state — no polling at all.

### Build Process

```
npm run build  →  /app/build/  →  copied to nginx /usr/share/nginx/html
```

The React app is compiled once during `docker compose build`. To apply frontend changes, you must rebuild.

---

## 8. Infrastructure — Docker & Caddy

### Docker Compose Services

**File:** `cloud/docker-compose.yml`

```
caddy      → exposes ports 80, 443 — sole public entry point
backend    → internal port 3001 only
frontend   → internal port 80 only
```

All three containers communicate over the internal Docker network `cloud_default`.
Nothing except Caddy is reachable from outside.

### Caddy Routing

**File:** `cloud/Caddyfile`

```
:80 {
    handle /ws     → reverse_proxy backend:3001  (WebSocket upgrade)
    handle /api/*  → reverse_proxy backend:3001  (REST API)
    handle /*      → reverse_proxy frontend:80   (React SPA)
}
```

Caddy automatically handles the HTTP → WebSocket upgrade for `/ws` — no special configuration needed beyond routing.

| Request | Path | Goes to |
|---------|------|---------|
| Browser opens dashboard | `/*` | nginx → React |
| React fetches history | `/api/alerts/sos` | Express |
| Gateway posts data | `/api/gateway/data` | Express |
| WebSocket connection | `/ws` | WebSocket server |

### Volumes

| Volume | Purpose |
|--------|---------|
| `sqlite-data` | SQLite database (`/app/data/`) |
| `caddy_data` | Caddy TLS certificates |
| `caddy_config` | Caddy internal config |

---

## 9. Security

### What Is Protected

| Endpoint | Protection |
|----------|-----------|
| `POST /api/gateway/data` | `x-gateway-token` header required |
| `GET /api/alerts/sos` | Open — anyone can read |
| `GET /ws` | Open — anyone can connect and see live events |

The token is compared server-side:
```js
if (GATEWAY_TOKEN && req.headers['x-gateway-token'] !== GATEWAY_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
}
```

If `GATEWAY_TOKEN` is not set in the environment, the check is skipped (useful for local development).

### Token Storage

- **Server:** `/home/deploy/sos-iot/cloud/.env` → injected via docker-compose `environment`
- **Laptop:** `cloud/gateway/.env` → loaded via `dotenv`
- **Git:** `.env` is in `.gitignore` — the token is never committed

### Current Risks

| Risk | Severity | Cause |
|------|----------|-------|
| Token sent over plain HTTP | High | No HTTPS — token can be intercepted on the network |
| SOS history readable by anyone | Low | `GET /api/alerts/sos` has no auth |
| Anyone can watch live alerts | Low | WebSocket `/ws` has no auth |
| No rate limiting | Medium | POST endpoint can be spammed to fill the DB |

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

**2. Firewall on the droplet** — block all ports except 80 and 443:
```bash
ufw allow 22    # SSH
ufw allow 80    # HTTP
ufw allow 443   # HTTPS
ufw enable
```

**3. Rate limiting** — add `express-rate-limit` to the POST endpoint to prevent DB spam.

---

## 10. Deployment

### First Deploy

```bash
# 1. Install Docker on the server
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker deploy

# 2. Copy files from laptop
scp -r cloud/ deploy@209.38.221.215:/home/deploy/sos-iot/

# 3. Create .env on the server
ssh deploy@209.38.221.215
echo "GATEWAY_TOKEN=your-secret-token-here" > /home/deploy/sos-iot/cloud/.env

# 4. Start everything
cd /home/deploy/sos-iot/cloud
docker compose up -d --build
```

### Update After Code Changes

```powershell
# From laptop — copy changed files
scp -r C:\...\cloud\backend deploy@209.38.221.215:/home/deploy/sos-iot/cloud/
scp -r C:\...\cloud\frontend\src deploy@209.38.221.215:/home/deploy/sos-iot/cloud/frontend/
```

```bash
# On server
cd /home/deploy/sos-iot/cloud
docker compose up -d --build
```

### Reset the Database

```bash
cd /home/deploy/sos-iot/cloud
docker compose down -v        # removes all volumes including SQLite
docker compose up -d --build  # fresh start
```

### Running the Gateway on the Laptop

```powershell
cd cloud/gateway
npm install
npm install dotenv

copy .env.example .env
# Edit .env: set SERIAL_PORT, CLOUD_URL=http://209.38.221.215, GATEWAY_TOKEN

node -r dotenv/config gateway.js
```

### Useful Server Commands

```bash
# Check container status
docker compose ps

# Stream all logs
docker compose logs -f

# Logs for one service
docker compose logs -f backend

# Restart a single service (e.g. after Caddyfile change)
docker compose restart caddy

# Stop everything (keeps volumes)
docker compose down

# Stop and delete all data
docker compose down -v
```
