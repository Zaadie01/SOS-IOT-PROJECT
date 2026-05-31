# SOS IoT — Project Documentation

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Components](#2-components)
3. [Data Flow](#3-data-flow)
4. [Firmware — HARDWARIO Device](#4-firmware--hardwario-device)
5. [Gateway — Local Bridge](#5-gateway--local-bridge)
6. [Backend — Cloud Server](#6-backend--cloud-server)
7. [Frontend — Web Dashboard](#7-frontend--web-dashboard)
8. [Infrastructure — Docker & Caddy](#8-infrastructure--docker--caddy)
9. [Security & Authentication](#9-security--authentication)
10. [Deployment](#10-deployment)
11. [Testing with Insomnia](#11-testing-with-insomnia)
12. [Database Reference](#12-database-reference)

---

## 1. System Overview

```
┌───────────────────┐   USB / Serial (UART)   ┌──────────────────────────┐
│  HARDWARIO Core   │ ──────────────────────► │  Gateway (laptop/Pi)     │
│  (IoT Device)     │   115200 baud           │  gateway/iot.js          │
│                   │                          │                          │
│  - SOS button     │                          │  - Reads Serial port     │
│  - LED feedback   │                          │  - Buffers events in     │
│  - TMP112 sensor  │                          │    local SQLite          │
└───────────────────┘                          │  - Registers with cloud  │
                                               │  - Sends heartbeat       │
                                               └─────────────┬────────────┘
                                                             │
                                               HTTPS POST    │ /api/gateway/data
                                               x-gateway-token: <token>
                                                             │
                                                             ▼
                                         ┌───────────────────────────────┐
                                         │   Cloud Server (Docker)       │
                                         │   app-project.org             │
                                         │                               │
                                         │  ┌─────────────────────────┐ │
                                         │  │  Caddy (port 80/443)    │ │
                                         │  │  reverse proxy + TLS    │ │
                                         │  └───────────┬─────────────┘ │
                                         │              │                │
                                         │   /api/* /ws │  /*           │
                                         │         ┌────┴────┐          │
                                         │         ▼         ▼          │
                                         │  ┌──────────┐ ┌──────────┐  │
                                         │  │ Backend  │ │ Frontend │  │
                                         │  │ :3001    │ │ :80      │  │
                                         │  │ Express  │ │ nginx    │  │
                                         │  │ SQLite   │ │ React    │  │
                                         │  │ WebSocket│ │Bootstrap │  │
                                         │  └──────────┘ └──────────┘  │
                                         └───────────────────────────────┘
                                                             ▲
                                               Browser ──────┘  wss://app-project.org/ws
```

---

## 2. Components

| Component | Runs On | Technologies | Entry Point |
|-----------|---------|-------------|-------------|
| Firmware | HARDWARIO Core Module | C, HARDWARIO SDK | `firmware/src/application.c` |
| Gateway | Laptop / Raspberry Pi | Node.js, serialport, better-sqlite3, axios | `gateway/iot.js` |
| Backend | Cloud server (Docker) | Node.js, Express, Passport.js, SQLite, ws | `cloud/backend/src/server.js` |
| Frontend | Browser | React 18, React Router v6, Bootstrap 5, @mdi/react | `cloud/frontend/src/` |
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
5.  Gateway writes the event to local SQLite:
    { button_pressed: 3, received_at: <unix ms>, sent_at: NULL }

6.  Gateway immediately tries to upload the event:
    POST /api/gateway/data
    Headers: { x-gateway-token: <token> }
    Body:    { timestamp, button_pressed, sos_alert: true }
    
    If cloud is unreachable → event stays in DB (sent_at = NULL)
    and is retried every 30 seconds until successful.

7.  Caddy receives the request, routes /api/* to backend:3001

8.  requireGateway middleware looks up the token in the gateways table
    → not found: 401 Unauthorized
    → found:     sets req.gateway, updates last_seen_at

9.  Backend inserts a row into sos_events:
    { timestamp, button_pressed, device_db_id: gateway.id, synced_at: now }

10. Backend broadcasts to all connected WebSocket clients:
    { "type": "sos", "event": { id, timestamp, button_pressed,
                                device_name, device_db_id, synced_at } }

11. Gateway marks the event as sent (sent_at = now) in local SQLite

12. Browser receives the WebSocket message instantly
13. React prepends the new alert to state — alert history updates with
    no page refresh needed; LastSosIndicator shows red for 5 minutes
```

### Device Registration Flow (Dashboard → Firmware)

```
1. User logs in to the web dashboard
2. User goes to Devices → Add Device → enters a name
3. Dashboard calls POST /api/devices
   ← Server creates a device slot in gateways table with:
     { owner_id: user.id, name: "Office Button",
       registration_code: "ABC12345", reg_code_expires_at: now+24h }
   ← Returns { id, name, registration_code, expires_at }

4. User copies the 8-character code into gateway/.env:
   REGISTRATION_CODE=ABC12345

5. Gateway starts and calls POST /api/gateway/register:
   Body: { registration_code: "ABC12345" }
   ← Server finds the slot, generates a 64-hex token, clears the code
   ← Returns { token: "a3f9c2...", device_id: 1 }

6. Gateway saves token to gateway_meta table (persists across restarts)

7. Device status in dashboard changes: pending → offline → online (after ping)
```

### WebSocket Connection Lifecycle

```
Browser opens app-project.org
  → React app loads (served by nginx via Caddy)
  → useAlerts hook: fetches GET /api/alerts/sos (initial history load)
  → Opens WebSocket: wss://app-project.org/ws
       → Caddy proxies /ws to backend:3001 (HTTP upgrade)
       → Connection established

From this point:
  → New SOS events pushed instantly — no polling
  → DevicesPage auto-refreshes every 15 s (status, last ping, SOS count)
  → Disconnect: reconnects automatically every 3 s
  → Browser goes offline (window 'offline' event): ws.close()
  → Browser comes back online (window 'online' event): reconnects
```

---

## 4. Firmware — HARDWARIO Device

**File:** `firmware/src/application.c`

Written in C using the HARDWARIO Tower SDK.

### Initialization

```c
void application_init(void)
```
- Initializes the LED for visual feedback
- Registers the button event handler
- Sets up the TMP112 temperature sensor (I2C)
- Initializes USB CDC for UART communication with the gateway

### Button Handler

- Fires on every button press
- Counts consecutive clicks
- Toggles the LED on each press
- Sends over UART:
  ```
  SOS:BUTTON_PRESS:COUNT:<N>
  ```

### UART Protocol

| Property | Value |
|----------|-------|
| Baud rate | 115200 |
| Delimiter | `\n` (newline) |
| SOS message | `SOS:BUTTON_PRESS:COUNT:N` |

The gateway only processes lines matching `SOS:BUTTON_PRESS`.

---

## 5. Gateway — Local Bridge

**File:** `gateway/iot.js`
**Container:** `gateway/Dockerfile` + `gateway/docker-compose.yml`

A Node.js process that bridges the HARDWARIO device (USB/UART) to the cloud backend. Can run on a laptop or Raspberry Pi.

### Configuration (`gateway/.env`)

| Variable | Purpose | Default |
|----------|---------|---------|
| `SERIAL_PORT` | USB port of the HARDWARIO device | `/dev/ttyUSB0` |
| `CLOUD_URL` | Backend server address | `https://app-project.org` |
| `REGISTRATION_CODE` | One-time code from the SOS IoT dashboard | — |
| `DB_PATH` | SQLite file path inside the container | `/data/gateway.db` |
| `DASHBOARD_PORT` | Local gateway dashboard port | `8080` |
| `UPLOAD_INTERVAL_MS` | Retry interval for pending events | `30000` (30 s) |
| `SENT_RETENTION_MS` | How long to keep sent events | `86400000` (24 h) |
| `REGISTER_RETRY_MS` | Retry interval if registration fails | `10000` (10 s) |
| `HEARTBEAT_INTERVAL_MS` | Liveness ping interval | `60000` (60 s) |

### Getting a Registration Code

1. Log in to the web dashboard → **Devices** → **Add Device**
2. Enter a device name — you'll receive an 8-character code (valid 24 h, one-time use)
3. Set it in `gateway/.env`: `REGISTRATION_CODE=XXXXXXXX`
4. Start the gateway — it registers automatically on first run and saves the token locally

The code is consumed after registration. On subsequent restarts the gateway uses the saved token.

### Local Database Schema

**Table `events`** — SOS events buffer:

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Auto-increment |
| `button_pressed` | INTEGER | Number of button clicks |
| `received_at` | INTEGER | Unix ms — when event arrived |
| `sent_at` | INTEGER | Unix ms — when uploaded (NULL = pending) |

**Table `gateway_meta`** — key-value persistent state:

| key | value |
|-----|-------|
| `token` | Auth token received from cloud after registration |

### Data Retention Policy

| Data | Retention |
|------|-----------|
| Unsent events (`sent_at IS NULL`) | **Infinite** — never deleted until uploaded |
| Sent events (`sent_at IS NOT NULL`) | **24 hours** — auto-cleaned |

### Gateway Dashboard

Local web dashboard at `http://localhost:8080`, auto-refreshes every 10 s:

- Cloud connection status (ONLINE / OFFLINE)
- Serial port status (CONNECTED / DISCONNECTED)
- Pending records (not yet uploaded)
- Sent records (within retention window)
- Last SOS event time
- Last successful upload time
- Registration status (YES / PENDING...)
- Uptime

JSON status at `GET http://localhost:8080/status`.

### Starting the Gateway

```bash
# Copy and fill in configuration
cp gateway/.env.example gateway/.env
# Edit .env: set CLOUD_URL and REGISTRATION_CODE

# Start with Docker
cd gateway
docker compose up -d --build

# View logs
docker compose logs -f
```

Expected startup output:
```
╔══════════════════════════════════════╗
║   HARDWARIO SOS Gateway              ║
╚══════════════════════════════════════╝
Serial:      /dev/ttyUSB0 @ 115200
Cloud:       https://app-project.org
DB:          /data/gateway.db
Upload:      every 30 s
Dashboard:   http://localhost:8080

[SERIAL] Connected to /dev/ttyUSB0
[REGISTER] Registering with cloud using registration code...
[REGISTER] Registration successful — token saved to local DB
[HEARTBEAT] OK
```

> Serial port and cloud registration start in **parallel** — SOS events are buffered locally from the first second, even if the cloud is not yet reachable.

---

## 6. Backend — Cloud Server

**Entry:** `cloud/backend/src/server.js`

Express.js + Passport.js + SQLite + WebSocket, running inside Docker.

### Project Structure

```
src/
├── server.js                  — HTTP server + WebSocket + SIGINT handler
├── app.js                     — Express middleware + route mounting
├── websocket.js               — WebSocket init and broadcast
├── config/
│   └── passport.js            — Local, JWT, Google OAuth strategies
├── db/
│   ├── index.js               — DB connection (exports db singleton)
│   ├── schema.js              — Table creation + migrations
│   └── cleanup.js             — Expired device cleanup job
├── middleware/
│   ├── auth.js                — requireAuth (JWT Bearer)
│   ├── gateway.js             — requireGateway (x-gateway-token)
│   └── validate.js            — express-validator result checker
├── routes/
│   ├── auth.routes.js         — Route definitions for /api/auth/*
│   ├── devices.routes.js      — Route definitions for /api/devices/*
│   ├── gateway.routes.js      — Route definitions for /api/gateway/*
│   └── alerts.routes.js       — Route definitions for /api/alerts/*
└── controllers/
    ├── auth.controller.js     — register, login, Google OAuth handlers
    ├── devices.controller.js  — CRUD handlers + status computation
    ├── gateway.controller.js  — register, SOS data, ping, warning handlers
    └── alerts.controller.js   — SOS history handler
```

### Database Schema

**Table `users`** — registered accounts:

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Auto-increment PK |
| `email` | TEXT | Unique email address |
| `password_hash` | TEXT | bcrypt hash (empty for Google-only accounts) |
| `role` | TEXT | `user` or `admin` |
| `display_name` | TEXT | Name shown in UI |
| `google_id` | TEXT | Linked Google account ID |
| `created_at` | INTEGER | Unix ms |

**Table `gateways`** — user-owned IoT devices:

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Auto-increment PK |
| `name` | TEXT | User-given device name |
| `owner_id` | INTEGER | FK → users.id |
| `token` | TEXT | Auth token used by firmware (NULL until registered) |
| `registration_code` | TEXT | One-time 8-char code (NULL after firmware registers) |
| `reg_code_expires_at` | INTEGER | Code expiry Unix ms |
| `registered_at` | INTEGER | When the device slot was created |
| `last_seen_at` | INTEGER | Last heartbeat or data upload time |
| `warning` | TEXT | Active warning from firmware (NULL = no warning) |

**Table `sos_events`** — SOS alert history:

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Auto-increment PK |
| `timestamp` | INTEGER | Event time (from firmware, falls back to server time) |
| `button_pressed` | INTEGER | Click count |
| `device_db_id` | INTEGER | FK → gateways.id |
| `synced_at` | INTEGER | Server receive time (used for sorting) |

### API Endpoints

#### Auth

| Method | URL | Auth | Description |
|--------|-----|------|-------------|
| `POST` | `/api/auth/register` | — | Create account, returns JWT |
| `POST` | `/api/auth/login` | — | Login, returns JWT |
| `GET` | `/api/auth/me` | JWT | Current user info |
| `GET` | `/api/auth/google` | — | Start Google OAuth |
| `GET` | `/api/auth/google/callback` | — | Google OAuth callback |
| `POST` | `/api/auth/google/prepare-link` | JWT | Step 1: save user in session for linking |
| `GET` | `/api/auth/google/link` | Session | Step 2: link Google to existing account |

#### Devices (all require JWT)

| Method | URL | Description |
|--------|-----|-------------|
| `GET` | `/api/devices` | List user's devices with computed status |
| `POST` | `/api/devices` | Create device slot, returns registration code |
| `PATCH` | `/api/devices/:id` | Rename device |
| `DELETE` | `/api/devices/:id` | Delete device and its SOS history |

#### Gateway (firmware → server, requires x-gateway-token except register)

| Method | URL | Description |
|--------|-----|-------------|
| `POST` | `/api/gateway/register` | Register with one-time code, receive token |
| `POST` | `/api/gateway/data` | Send SOS event |
| `POST` | `/api/gateway/ping` | Heartbeat — update last_seen_at |
| `POST` | `/api/gateway/warning` | Set or clear a warning message |

#### Alerts (requires JWT)

| Method | URL | Description |
|--------|-----|-------------|
| `GET` | `/api/alerts/sos` | SOS history for user's devices |
| `GET` | `/api/alerts/sos?device_id=N` | Filtered by specific device |

### Device Status Logic

Status is computed on-the-fly from existing DB fields, no extra column needed:

```
token IS NULL               → pending  (firmware never connected)
warning IS NOT NULL         → warning  (firmware reported a problem)
last_seen_at IS NULL        → offline
now - last_seen_at < 5 min  → online
now - last_seen_at ≥ 5 min  → offline
```

### WebSocket

Server path: `/ws`
Public URL: `wss://app-project.org/ws`

On SOS event received, backend broadcasts to all connected clients:

```json
{
  "type": "sos",
  "event": {
    "id": 42,
    "timestamp": 1700000000000,
    "synced_at": 1700000000100,
    "button_pressed": 3,
    "device_name": "Office Button",
    "device_db_id": 1
  }
}
```

---

## 7. Frontend — Web Dashboard

**Folder:** `cloud/frontend/src/`

React 18 SPA, compiled to static files served by nginx.

### Project Structure

```
src/
├── index.js                — Bootstrap CSS + ReactDOM entry point
├── App.js                  — BrowserRouter + AuthProvider
├── AppRouter.jsx           — All <Route> definitions
├── App.css                 — Global styles (Inter font, Bootstrap overrides)
├── api/
│   └── index.js            — Unified API client (JWT auth, 401 handling)
├── context/
│   └── AuthContext.js      — JWT token + user state in localStorage
├── hooks/
│   └── useAlerts.js        — Fetch SOS history + WebSocket live updates
├── utils/
│   └── time.js             — formatTime helper (HH:MM:SS, DD/MM/YYYY)
├── components/
│   ├── auth/ProtectedRoute.jsx
│   ├── layout/Navbar.jsx
│   ├── common/
│   │   ├── GoogleLogo.jsx
│   │   └── StatusBadge.jsx
│   ├── devices/
│   │   ├── DeviceModal.jsx  — Add / Rename / Delete / Show code modals
│   │   └── CodeBanner.jsx
│   └── alerts/
│       ├── DeviceFilter.jsx
│       └── LastSosIndicator.jsx
└── pages/
    ├── LandingPage.jsx
    ├── LoginPage.jsx
    ├── RegisterPage.jsx
    ├── DevicesPage.jsx      — Device grid, search/sort/filter, auto-refresh 15 s
    └── AlertsPage.jsx       — SOS history table, pagination (25/page), device filter
```

### Routes

| Path | Auth required | Description |
|------|--------------|-------------|
| `/` | — | Landing page (redirects to /devices if logged in) |
| `/login` | — | Login with email/password or Google |
| `/register` | — | Register with email/password or Google |
| `/devices` | ✅ | Device management |
| `/alerts` | ✅ | SOS alert history |
| `/alerts?device=N` | ✅ | Alerts pre-filtered by device |

### Authentication Flow

```
Login → POST /api/auth/login → { token, user }
     → stored in localStorage (sos_auth_token, sos_auth_user)
     → all subsequent API calls include: Authorization: Bearer <token>
     → 401 with a stored token → force logout + redirect to /login
     → 401 without a stored token → show error in form (login attempt)

Google OAuth → click "Continue with Google"
           → GET /api/auth/google → redirect to Google
           → Google callback → POST /api/auth/google/callback
           → redirect to /login?token=...&user=...
           → LoginPage reads params → stores token + user
```

---

## 8. Infrastructure — Docker & Caddy

### Docker Compose Services

**File:** `cloud/docker-compose.yml`

```
caddy     → ports 80, 443 — sole public entry point
backend   → internal port 3001 only
frontend  → internal port 80 only
```

All three containers share the internal Docker network `sos-iot`.
Nothing except Caddy is reachable from outside the host.

**File:** `gateway/docker-compose.yml`

```
gateway   → port 8080 (local dashboard)
            mounts SERIAL_PORT device for USB serial access
            volume gateway-sqlite for SQLite persistence
```

### Caddy Routing

**File:** `cloud/Caddyfile`

```
app-project.org {
    handle /ws     { reverse_proxy backend:3001 }   # WebSocket
    handle /api/*  { reverse_proxy backend:3001 }   # REST API
    handle /*      { reverse_proxy frontend:80  }   # React SPA
}
```

### Docker Volumes

| Volume | Service | Purpose |
|--------|---------|---------|
| `sqlite-data` | Backend | SOS events + user data (`/app/data/`) |
| `caddy_data` | Caddy | TLS certificates |
| `caddy_config` | Caddy | Internal Caddy config |
| `gateway-sqlite` | Gateway | Local event buffer + meta |

### Auto-restart

All containers use `restart: unless-stopped`:
- Start automatically on Docker daemon start (e.g. server reboot)
- Restart automatically on crash
- Stay stopped only after explicit `docker compose down`

---

## 9. Security & Authentication

### User Authentication

| What | How |
|------|-----|
| Password login | Passport.js Local strategy + bcrypt |
| Token issuance | JWT, signed with `JWT_SECRET`, 8-hour expiry |
| Protected routes | `requireAuth` middleware (passport-jwt) |
| Google OAuth | Passport.js Google strategy; auto-links if email matches |

### Device Authentication

| What | How |
|------|-----|
| First registration | One-time 8-char code issued by the dashboard (24 h TTL) |
| Ongoing auth | Per-device 64-hex token in `x-gateway-token` header |
| Token lookup | `requireGateway` middleware: `SELECT * FROM gateways WHERE token = ?` |
| Token storage (cloud) | `gateways.token` in SQLite |
| Token storage (gateway) | `gateway_meta` table in local SQLite |

### Ownership & Isolation

- Each device belongs to one user (`owner_id`)
- `GET /api/devices` and `GET /api/alerts/sos` only return rows where `owner_id = req.user.id`
- Attempting to rename/delete another user's device returns **404**

### What Is Protected

| Endpoint | Protection |
|----------|-----------|
| `POST /api/auth/register` | Open — validated by express-validator |
| `POST /api/auth/login` | Open |
| `GET /api/auth/me` | JWT required |
| `GET /api/devices` and children | JWT required |
| `GET /api/alerts/sos` | JWT required |
| `POST /api/gateway/register` | Valid registration code required |
| `POST /api/gateway/data` | Per-device token required |
| `POST /api/gateway/ping` | Per-device token required |
| `POST /api/gateway/warning` | Per-device token required |

### Secrets Management

All secrets are in `.env` files, never committed to git:

| Secret | File | Used for |
|--------|------|---------|
| `JWT_SECRET` | `cloud/backend/.env` | Signing user JWTs |
| `SESSION_SECRET` | `cloud/backend/.env` | Google OAuth session |
| `GOOGLE_CLIENT_ID` | `cloud/backend/.env` | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | `cloud/backend/.env` | Google OAuth |

---

## 10. Deployment

### Prerequisites (server)

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Install rsync (for local-deploy.sh)
# On local machine (Debian/Ubuntu):
sudo apt install rsync
```

### First Deploy

```bash
# 1. Create backend .env on the server (one time)
ssh deploy@<YOUR_SERVER>
cp ~/sos/SOS-IOT-PROJECT/cloud/backend/.env.example \
   ~/sos/SOS-IOT-PROJECT/cloud/backend/.env
nano ~/sos/SOS-IOT-PROJECT/cloud/backend/.env
# Fill in: JWT_SECRET, SESSION_SECRET, GOOGLE_CLIENT_ID, etc.

# 2. From your local machine, deploy
cd SOS-IOT-PROJECT
bash cloud/scripts/local-deploy.sh
```

`local-deploy.sh` does:
1. Builds Docker images locally (no load on the server)
2. Transfers images over SSH via `docker save | gzip | ssh | docker load`
3. Syncs compose files via `rsync`
4. Runs `docker compose up -d` on the server

### Subsequent Deploys

```bash
bash cloud/scripts/local-deploy.sh
```

### Rollback

```bash
# Manual rollback to the previous images
bash cloud/scripts/rollback.sh

# Or on the server directly
ssh deploy@<YOUR_SERVER> "bash ~/sos/SOS-IOT-PROJECT/cloud/scripts/rollback.sh"
```

### Gateway

```bash
# First time
cp gateway/.env.example gateway/.env
# Edit .env: set CLOUD_URL and REGISTRATION_CODE (from the web dashboard)

# Start
cd gateway
docker compose up -d --build

# View logs
docker compose logs -f
```

### Useful Commands

```bash
# Check container status
ssh deploy@<YOUR_SERVER> "cd ~/sos/SOS-IOT-PROJECT/cloud && docker compose ps"

# Stream backend logs
ssh deploy@<YOUR_SERVER> "docker logs -f sos-backend"

# Reset database (deletes all users, devices, alerts)
ssh deploy@<YOUR_SERVER> "docker exec sos-backend rm /app/data/gateway_data.db && docker restart sos-backend"

# Make a user admin
ssh deploy@<YOUR_SERVER> "docker exec sos-backend node -e \
  \"const db = require('better-sqlite3')('/app/data/gateway_data.db'); \
    db.prepare(\\\"UPDATE users SET role = 'admin' WHERE email = ?\\\").run('you@example.com'); \
    console.log('done');\""
```

---

## 11. Testing with Insomnia

Import `cloud/insomnia.yaml` into Insomnia. Set `base_url = https://app-project.org` in the environment.

### Recommended test order

```
1. Auth → POST /register         → copy token → jwt_token
2. Auth → POST /login            → verify token works
3. Auth → GET /me                → check user fields

4. Devices → POST /devices       → copy id → device_db_id
                                   copy registration_code → registration_code
5. Devices → GET /devices        → status should be "pending"

6. Gateway → POST /gateway/register  → copy token → gateway_token
7. Devices → GET /devices            → status should be "offline"

8. Gateway → POST /gateway/ping      → status becomes "online"
9. SOS Data → POST /gateway/data ✅  → sends SOS
10. Alerts → GET /alerts/sos         → alert appears with device_name

11. Gateway → POST /gateway/warning  → device status = "warning"
12. Gateway → POST /gateway/warning (clear) → status returns to online/offline

13. Devices → PATCH → rename
14. Alerts → GET /alerts/sos?device_id=N → filter works
15. Devices → DELETE → device + history removed

--- Negative cases ---
Auth    → POST /login wrong password → 401
Devices → GET /devices no token      → 401
Devices → DELETE /devices/9999       → 404 (not owner)
Gateway → POST /gateway/data no token → 401
Gateway → POST /gateway/register bad code → 401
Auth    → GET /api/auth/google (no GOOGLE_CLIENT_ID) → 503
```

---

## 12. Database Reference

### Cloud Backend

```bash
# Enter the backend container
ssh deploy@<YOUR_SERVER>
docker exec -it sos-backend sh
sqlite3 /app/data/gateway_data.db

# Useful queries
.tables
SELECT id, email, role, display_name FROM users;
SELECT id, name, owner_id, status FROM gateways;   -- status computed in app, not stored
SELECT se.id, se.timestamp, g.name AS device, se.button_pressed
  FROM sos_events se JOIN gateways g ON g.id = se.device_db_id
  ORDER BY se.synced_at DESC LIMIT 20;
.quit
```

Or without entering the container:
```bash
docker exec sos-backend sqlite3 /app/data/gateway_data.db \
  "SELECT * FROM sos_events ORDER BY synced_at DESC LIMIT 10;"
```

### Gateway (local)

```bash
docker exec -it sos-gateway sh
sqlite3 /data/gateway.db

.tables
SELECT * FROM events WHERE sent_at IS NULL;   -- pending uploads
SELECT * FROM gateway_meta;                   -- saved auth token
SELECT * FROM events ORDER BY received_at DESC LIMIT 20;
.quit
```
