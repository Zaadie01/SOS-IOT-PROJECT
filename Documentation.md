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

10. Backend resolves recipients: device owner + all accepted invitees
    (SELECT invitee_id FROM device_invitations WHERE device_id = ? AND status = 'accepted')
    Sends WS message only to those users' connected sockets:
    {
      "type": "sos",
      "event": {
        "id": 42, "timestamp": …, "synced_at": …, "button_pressed": 3,
        "device_name": "Office Button", "device_db_id": 1, "owner_name": "Alice"
      }
    }

11. Gateway marks the event as sent (sent_at = now) in local SQLite

12. Each recipient's browser receives the WebSocket message instantly
13. React prepends the new alert to state — history updates with no page refresh
    If the browser permission is granted and the device has notifications
    enabled → browser push notification fires, even if the user is on a
    different tab or the Notifications panel is closed
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

### Invitation Flow (share device access)

```
1. Owner (Alice) opens a device card → Share → Manage Access modal
2. Alice enters Bob's User ID (or email) → Send invitation
3. POST /api/devices/:id/invitations { user_id: N }
   ← 201 { id: <inv_id>, status: "pending" }

4. Bob opens his dropdown → "Invitations" (red badge = 1 pending)
5. Bob clicks Accept → POST /api/invitations/:id/accept
   ← status changes to "accepted"

6. Bob now sees Alice's device in GET /api/devices (is_owner: false)
   registration_code is null; Rename/Delete/Share buttons are hidden

7. Bob sees Alice's device alerts in GET /api/alerts/sos

8. When Alice's device fires SOS, the WS message goes to Alice AND Bob
   (if Bob has notifications enabled → browser push fires for Bob too)

9. Alice can revoke at any time → POST /api/invitations/:id/revoke
   Bob's access is removed immediately; notification_prefs cleaned up
```

### WebSocket Connection Lifecycle

```
Browser opens app-project.org
  → React app loads; AlertsProvider mounts (inside AuthProvider)
  → Fetches GET /api/alerts/sos — records baseline alert ID
  → Loads GET /api/notifications — loads per-device push prefs
  → Reads localStorage['sos_notifications_enabled'] — master push toggle (default on)
  → Opens WebSocket: wss://app-project.org/ws?token=<JWT>
       → Caddy proxies /ws to backend:3001 (HTTP upgrade)
       → Server verifies JWT from query string, stores userId on socket
       → Connection established

From this point:
  → SOS events pushed only to owner + accepted invitees (not broadcast to all)
  → Push notification fired if: permission granted + master toggle on
    + device pref enabled + alert ID > baseline (prevents false push on first load)
  → WebSocket survives route changes (AlertsProvider lives at app root)
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
├── server.js                      — HTTP server + WebSocket + SIGINT handler
├── app.js                         — Express middleware + route mounting
├── websocket.js                   — WebSocket init, JWT auth on connect,
│                                    broadcast(), sendToUsers()
├── config/
│   └── passport.js                — Local, JWT, Google OAuth strategies
├── db/
│   ├── index.js                   — DB connection (exports db singleton)
│   ├── schema.js                  — Table creation + migrations
│   └── cleanup.js                 — Expired device cleanup job
├── middleware/
│   ├── auth.js                    — requireAuth (JWT Bearer)
│   ├── gateway.js                 — requireGateway (x-gateway-token)
│   └── validate.js                — express-validator result checker
├── routes/
│   ├── auth.routes.js             — /api/auth/*
│   ├── devices.routes.js          — /api/devices/*
│   ├── gateway.routes.js          — /api/gateway/*
│   ├── alerts.routes.js           — /api/alerts/*
│   ├── invitations.routes.js      — /api/devices/:id/invitations, /api/invitations/*
│   └── notifications.routes.js   — /api/notifications[/:deviceId]
└── controllers/
    ├── auth.controller.js         — register, login, Google OAuth handlers
    ├── devices.controller.js      — CRUD + status computation
    ├── gateway.controller.js      — register, SOS data, ping, warning handlers
    ├── alerts.controller.js       — SOS history (owner + accepted invitees)
    ├── invitations.controller.js  — invitation CRUD (owner & invitee sides)
    └── notifications.controller.js — per-device push notification prefs
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

**Table `devices`** — user-owned IoT devices (was `gateways` in older installs; auto-renamed on startup):

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
| `device_db_id` | INTEGER | FK → devices.id |
| `synced_at` | INTEGER | Server receive time (used for sorting) |

**Table `device_invitations`** — shared device access:

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Auto-increment PK |
| `device_id` | INTEGER | FK → devices.id |
| `inviter_id` | INTEGER | FK → users.id (owner who sent the invite) |
| `invitee_id` | INTEGER | FK → users.id (user being invited) |
| `status` | TEXT | `pending` \| `accepted` \| `declined` |
| `created_at` | INTEGER | Unix ms — when invitation was created / last resent |
| `responded_at` | INTEGER | Unix ms — when invitee accepted or declined |

Unique constraint: `(device_id, invitee_id)`.

Status transitions:
- Owner creates → `pending`
- Invitee: `pending` → `accepted` or `declined`
- Invitee: `accepted` → `declined` via `DELETE /api/devices/:id/access` (self-removal)
- Owner: delete row (any status)
- Owner resends after `declined` → resets to `pending`

**Table `notification_prefs`** — per-device push notification opt-in:

| Column | Type | Description |
|--------|------|-------------|
| `user_id` | INTEGER | FK → users.id |
| `device_id` | INTEGER | FK → devices.id |
| `enabled` | INTEGER | `1` = enabled, `0` = disabled |

Primary key: `(user_id, device_id)`. Only users with access (owner or accepted invitee) can set a pref.

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
| `GET` | `/api/devices` | List own + accepted-invitation devices. Each device includes `is_owner`, `owner_id`, `owner_name`. `registration_code` is `null` for non-owners. |
| `POST` | `/api/devices` | Create device slot, returns registration code. Owner only. |
| `PATCH` | `/api/devices/:id` | Rename device. Owner only. |
| `DELETE` | `/api/devices/:id` | Delete device, SOS history, all invitations, and notification prefs. Owner only. |

#### Invitations (all require JWT)

**Owner side:**

| Method | URL | Description |
|--------|-----|-------------|
| `POST` | `/api/devices/:id/invitations` | Invite a user by `user_id` or `email`. Returns 201 `{id, status:"pending"}`. 409 if already `pending`\|`accepted`; resends if `declined`. |
| `GET` | `/api/devices/:id/invitations` | List all invitations for a device: `id`, `invitee_id`, `invitee_name`, `invitee_email`, `status`, `created_at`. |
| `DELETE` | `/api/invitations/:id` | Permanently delete an invitation row (any status). Removes invitee's notification prefs. |

**Invitee side:**

| Method | URL | Description |
|--------|-----|-------------|
| `GET` | `/api/invitations/received` | My incoming invitations: `id`, `device_id`, `device_name`, `owner_name`, `status`, `created_at`. |
| `POST` | `/api/invitations/:id/accept` | Accept a `pending` invitation. |
| `POST` | `/api/invitations/:id/decline` | Decline a `pending` invitation. |
| `DELETE` | `/api/devices/:id/access` | Stop watching — invitee removes own `accepted` access. Sets status to `declined`, removes notification prefs. |

#### Notifications (all require JWT)

| Method | URL | Description |
|--------|-----|-------------|
| `GET` | `/api/notifications` | Get all push notification prefs: `{ prefs: { [device_id]: bool } }`. |
| `PUT` | `/api/notifications/:deviceId` | Enable or disable push for a device. Body: `{ enabled: true\|false }`. 403 if no access. |

#### Gateway (requires `x-gateway-token` except register)

| Method | URL | Description |
|--------|-----|-------------|
| `POST` | `/api/gateway/register` | Register with one-time code, receive token |
| `POST` | `/api/gateway/data` | Send SOS event |
| `POST` | `/api/gateway/ping` | Heartbeat — update last_seen_at |
| `POST` | `/api/gateway/warning` | Set or clear a warning message |

#### Alerts (requires JWT)

| Method | URL | Description |
|--------|-----|-------------|
| `GET` | `/api/alerts/sos` | SOS history for own + accepted-invitation devices. Each alert includes `owner_name`. |
| `GET` | `/api/alerts/sos?device_id=N` | Same, filtered by a specific device. |

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

The client connects with a JWT in the query string:
```
wss://app-project.org/ws?token=<JWT>
```

On connect, the server verifies the JWT and stores `userId` on the socket. This enables **targeted delivery**: SOS events are sent only to the device owner and all users with an accepted invitation, not broadcast globally.

SOS event shape (identical for WebSocket push and `GET /api/alerts/sos` rows):

```json
{
  "type": "sos",
  "event": {
    "id": 42,
    "timestamp": 1700000000000,
    "synced_at": 1700000000100,
    "button_pressed": 3,
    "device_name": "Office Button",
    "device_db_id": 1,
    "owner_name": "Alice"
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
├── index.js                      — Bootstrap CSS + ReactDOM entry point
├── App.js                        — BrowserRouter + AuthProvider + AlertsProvider
├── AppRouter.jsx                 — All <Route> definitions
├── App.css                       — Global styles (Inter font, Bootstrap overrides)
├── api/
│   └── index.js                  — Unified API client (JWT auth, 401 handling,
│                                   all invitation + notification helpers)
├── context/
│   ├── AuthContext.js            — JWT token + user state in localStorage
│   └── AlertsContext.js          — Global WS connection, alerts state,
│                                   notification prefs, master toggle
│                                   (localStorage-persisted), push dispatch
├── hooks/
│   └── useAlerts.js              — Legacy standalone hook (not used by AlertsPage)
├── utils/
│   └── time.js                   — formatTime helper (HH:MM:SS, DD/MM/YYYY)
├── components/
│   ├── auth/ProtectedRoute.jsx
│   ├── layout/Navbar.jsx         — User dropdown: ID #N, Invitations badge
│   ├── invitations/
│   │   └── InvitationsModal.jsx  — Accept / Decline inbox modal
│   ├── common/
│   │   ├── GoogleLogo.jsx
│   │   └── StatusBadge.jsx
│   ├── devices/
│   │   ├── DeviceModal.jsx       — Add / Rename / Delete / Show code modals
│   │   ├── DeviceCard.jsx        — Single device card (owner/guest variants)
│   │   ├── ShareModal.jsx        — Manage Access: invite form + invitations list
│   │   └── CodeBanner.jsx
│   └── alerts/
│       ├── DeviceFilter.jsx
│       ├── LastSosIndicator.jsx
│       └── NotificationsPanel.jsx — Push prefs: master toggle + per-device checklist
└── pages/
    ├── LandingPage.jsx
    ├── LoginPage.jsx
    ├── RegisterPage.jsx
    ├── DevicesPage.jsx            — Device grid, search/sort/filter, auto-refresh
    └── AlertsPage.jsx             — SOS history table + Owner column,
                                     Notifications panel toggle, push from AlertsContext
```

### Context Architecture

```
<BrowserRouter>
  <AuthProvider>          ← JWT token + user, persisted to localStorage
    <AlertsProvider>      ← Single WS connection + alerts + prefs + push logic
      <AppRouter />       ← Routes, Navbar, Pages
    </AlertsProvider>
  </AuthProvider>
</BrowserRouter>
```

`AlertsProvider` is mounted at the app root (not inside any page component). This means:
- **One WebSocket** per session — no duplicate connections when navigating between pages
- **Push notifications fire globally** — independent of which page is open and whether the Notifications panel is visible
- **Baseline protection** — the newest historic alert ID is recorded at load time; only events with a higher ID trigger a push, preventing false notifications on first load
- **Master toggle** — `notificationsEnabled` in localStorage; survives page reload; gates all pushes before per-device prefs are checked

### Routes

| Path | Auth required | Description |
|------|--------------|-------------|
| `/` | — | Landing page (redirects to /devices if logged in) |
| `/login` | — | Login with email/password or Google |
| `/register` | — | Register with email/password or Google |
| `/devices` | ✅ | Device management |
| `/alerts` | ✅ | SOS alert history |
| `/alerts?device=N` | ✅ | Alerts pre-filtered by device |

### Push Notification Flow

```
1. User opens Alerts → Notifications panel → clicks "Enable"
   → Notification.requestPermission() → browser prompts
   → On grant: per-device checklist appears

2. User checks a device → PUT /api/notifications/:deviceId { enabled: true }
   → pref stored in DB and in AlertsContext.prefs

3. SOS arrives via WebSocket in AlertsContext:
   a. Alert prepended to state (AlertsPage updates instantly)
   b. event.id > baselineId?                  → yes, continue
   c. Notification.permission === 'granted'?  → yes, continue
   d. notificationsEnabled === true?          → yes, continue (master toggle)
   e. prefs[event.device_db_id] === true?     → yes, fire push
   → new Notification("SOS: Office Button", { body: "14:32:01 01/06/2026" })

4. Master toggle and per-device prefs are independent:
   turning off master hides the checklist but prefs are kept in DB.
   Re-enabling master instantly restores all previous per-device settings.
   Master state persists in localStorage across page reloads.

5. Push fires regardless of current route (Devices, Alerts, or any other)
   Push fires even if the Notifications panel is collapsed
```

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
| WebSocket auth | JWT passed in `?token=` query string; verified on connect |

### Device Authentication

| What | How |
|------|-----|
| First registration | One-time 8-char code issued by the dashboard (24 h TTL) |
| Ongoing auth | Per-device 64-hex token in `x-gateway-token` header |
| Token lookup | `requireGateway` middleware: `SELECT * FROM devices WHERE token = ?` |
| Token storage (cloud) | `devices.token` in SQLite |
| Token storage (gateway) | `gateway_meta` table in local SQLite |

### Ownership & Access Control

- Each device belongs to one owner (`owner_id`)
- **Owner** can: Rename, Delete, Show registration code, Share (invite), Delete invitations
- **Accepted invitee** can: View device and its alerts, enable/disable push notifications, stop watching (self-remove)
- **Non-invited user** sees nothing — not in `GET /api/devices`, not in alerts, no WS delivery
- `GET /api/devices` returns own devices + accepted-invitation devices; `registration_code` is `null` for non-owners
- `GET /api/alerts/sos` returns alerts from own + accepted-invitation devices
- Rename/Delete a device owned by another user → **404**
- Setting a notification pref for a device without access → **403**

### What Is Protected

| Endpoint | Protection |
|----------|-----------|
| `POST /api/auth/register` | Open — validated by express-validator |
| `POST /api/auth/login` | Open |
| `GET /api/auth/me` | JWT required |
| `GET /api/devices` and children | JWT required |
| `GET /api/alerts/sos` | JWT required |
| `GET|POST|DELETE /api/invitations/*` | JWT required; ownership/invitee checked per action |
| `DELETE /api/devices/:id/access` | JWT required; invitee only (own accepted access) |
| `GET|PUT /api/notifications/*` | JWT required; access verified before write |
| `POST /api/gateway/register` | Valid registration code required |
| `POST /api/gateway/data` | Per-device token required |
| `POST /api/gateway/ping` | Per-device token required |
| `POST /api/gateway/warning` | Per-device token required |

### Secrets Management

All secrets are in `.env` files, never committed to git:

| Secret | File | Used for |
|--------|------|---------|
| `JWT_SECRET` | `cloud/backend/.env` | Signing user JWTs (also verified on WS connect) |
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

### Environment Variables

| Variable | Where to get it |
|----------|----------------|
| `jwt_token` | Response of `POST /auth/login` (Alice) |
| `jwt_token_b` | Response of `POST /auth/register` or `/login` (Bob) |
| `device_db_id` | Response of `POST /devices` → `id` |
| `registration_code` | Response of `POST /devices` → `registration_code` |
| `gateway_token` | Response of `POST /gateway/register` → `token` |
| `invitee_user_id` | Response of `GET /auth/me` with `jwt_token_b` → `user.id` |
| `invitation_id` | Response of `POST /devices/:id/invitations` → `id` |

### Recommended test order

```
── Core flow ────────────────────────────────────────────────────────────────
1.  Auth → POST /register (Alice)    → copy token → jwt_token
2.  Auth → POST /login (Alice)       → verify token works
3.  Auth → GET /me                   → confirm id, email

4.  Devices → POST /devices          → copy id → device_db_id
                                       copy registration_code → registration_code
5.  Devices → GET /devices           → status "pending"; is_owner=true

6.  Gateway → POST /gateway/register → copy token → gateway_token
7.  Devices → GET /devices           → status "offline"

8.  Gateway → POST /gateway/ping     → status becomes "online"
9.  SOS Data → POST /gateway/data ✅ → SOS fires (WS delivers to Alice only)
10. Alerts → GET /alerts/sos         → alert appears; owner_name = "Alice"

11. Gateway → POST /gateway/warning  → device status = "warning"
12. Gateway → POST /gateway/warning (clear) → status returns to online/offline

13. Devices → PATCH → rename
14. Alerts → GET /alerts/sos?device_id=N → filter works
15. Notifications → PUT /notifications/:id { enabled:true } → 200 ok
16. Notifications → GET /notifications → pref shows true for device

── Invitation flow (two accounts) ───────────────────────────────────────────
17. Auth → POST /register (Bob)      → copy token → jwt_token_b
18. Auth → GET /me (Bob)             → copy id → invitee_user_id

19. Invitations → POST /devices/:id/invitations { user_id: invitee_user_id }
                                     → copy id → invitation_id; status = pending
20. Invitations → GET /devices/:id/invitations → list shows pending row

21. Invitations → GET /invitations/received (Bob / jwt_token_b)
                                     → inbox shows pending; badge count = 1
22. Invitations → POST /invitations/:id/accept (Bob) → status = accepted

23. Devices → GET /devices (Bob)     → Alice's device visible; is_owner=false;
                                       registration_code = null
24. Alerts → GET /alerts/sos (Bob)   → Alice's alerts visible with owner_name
25. SOS Data → POST /gateway/data ✅ → WS delivers to BOTH Alice AND Bob

26. Invitations → DELETE /devices/:id/access (Bob)  → status = declined;
                                     Bob's device gone from his list
27. Invitations → GET /devices/:id/invitations (Alice) → row shows declined

28. Invitations → POST /devices/:id/invitations (resend) → resets to pending
29. Invitations → POST /invitations/:id/accept (Bob) → accepted again
30. Invitations → DELETE /invitations/:id (Alice)    → row deleted; Bob loses access

── Negative cases ────────────────────────────────────────────────────────────
Auth          → POST /login wrong password              → 401
Devices       → GET /devices no token                  → 401
Devices       → DELETE /devices/9999                   → 404 (not owner)
Gateway       → POST /gateway/data no token            → 401
Gateway       → POST /gateway/register bad code        → 401
Invitations   → POST /invitations/:id/accept (Alice)   → 404 (not invitee)
Invitations   → POST /devices/:id/invitations (dup)    → 409 (already active)
Invitations   → DELETE /devices/:id/access (no access) → 404
Notifications → PUT /notifications/9999 { enabled:true } → 403 (no access)
Auth          → GET /api/auth/google (no GOOGLE_CLIENT_ID) → 503
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
SELECT id, name, owner_id FROM devices;
SELECT se.id, se.timestamp, g.name AS device, se.button_pressed
  FROM sos_events se JOIN devices g ON g.id = se.device_db_id
  ORDER BY se.synced_at DESC LIMIT 20;

-- Invitations
SELECT di.id, g.name AS device, u1.email AS owner, u2.email AS invitee, di.status
  FROM device_invitations di
  JOIN devices g ON g.id = di.device_id
  JOIN users u1 ON u1.id = di.inviter_id
  JOIN users u2 ON u2.id = di.invitee_id;

-- Notification prefs
SELECT u.email, g.name AS device, np.enabled
  FROM notification_prefs np
  JOIN users u ON u.id = np.user_id
  JOIN devices g ON g.id = np.device_id;

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
