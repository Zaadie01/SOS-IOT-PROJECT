# Testing Guide — SOS IoT Dashboard

Complete step-by-step instructions for testing the backend API with Insomnia and the frontend in the browser.

---

## Prerequisites

- **Node.js** v18+ (for running locally without Docker)
- **Docker + Docker Compose** (for running the full stack)
- **Insomnia** — import `cloud/insomnia.yaml`
- _(Optional)_ Google Cloud Console account for Google OAuth testing

---

## 1. Setup

### 1a. Backend — environment

```bash
cd cloud/backend
cp .env.example .env
```

Edit `.env` and fill in at minimum:

```
JWT_SECRET=some-very-long-random-string
SESSION_SECRET=another-random-string
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=admin123
```

### 1b. Install dependencies

```bash
# Backend
cd cloud/backend && npm install

# Frontend
cd cloud/frontend && npm install
```

### 1c. Start the services

**Option A — locally (two terminals):**

```bash
# Terminal 1 — backend
cd cloud/backend
npm run dev          # starts on http://localhost:3001

# Terminal 2 — frontend
cd cloud/frontend
npm start            # starts on http://localhost:3000
```

**Option B — Docker:**

```bash
cd cloud
docker-compose up --build
```

---

## 2. Import Insomnia Collection

1. Open Insomnia → **File → Import**
2. Select `cloud/insomnia.yaml`
3. Open **Environments** (top-left dropdown) → **Base Environment**
4. Set `base_url` to `http://localhost:3001` (already set as default)
5. Leave `jwt_token` and `gateway_token` empty for now — you will fill them in as you run requests

---

## 3. Test Flows

Follow the flows in order. After each step that returns a token or ID, paste the value into the Insomnia environment variable shown in parentheses.

---

### Flow 1 — Admin login

| # | Request | Folder | Expected |
|---|---------|--------|----------|
| 1 | `GET /` | Health | `200 { status: "OK" }` |
| 2 | `POST /api/auth/login` (admin) | Auth | `200 { token, user }` |

After step 2: copy the `token` value → paste into **`jwt_token`** env variable.

---

### Flow 2 — User registration

| # | Request | Expected |
|---|---------|----------|
| 1 | `POST /api/auth/register` (new user) | `201 { token, user }` |
| 2 | `POST /api/auth/register` (same email) | `409 Email already registered` |
| 3 | `POST /api/auth/register` (short password) | `400 Password must be at least 6 characters` |

---

### Flow 3 — Create a device and get registration code

> Make sure `jwt_token` is set from Flow 1 or 2.

| # | Request | Expected |
|---|---------|----------|
| 1 | `POST /api/devices` | `201 { id, name, registration_code, expires_at }` |
| 2 | `GET /api/devices` | `200 { devices: [...] }` — device appears with `is_registered: 0` |

After step 1: copy `id` → **`device_db_id`**, copy `registration_code` → **`registration_code`**.

---

### Flow 4 — Firmware: register gateway with code

| # | Request | Expected |
|---|---------|----------|
| 1 | `POST /api/gateway/register` (with code) | `201 { token }` |
| 2 | `POST /api/gateway/register` (same code again) | `401 Invalid or expired registration code` — code is consumed |
| 3 | `GET /api/devices` | device now shows `is_registered: 1`, `registration_code: null` |

After step 1: copy `token` → **`gateway_token`**.

---

### Flow 5 — Firmware: send data

| # | Request | Expected |
|---|---------|----------|
| 1 | `POST /api/gateway/ping` | `200 { ok: true, server_time: ... }` |
| 2 | `POST /api/gateway/data` (non-SOS) | `200 Non-SOS data ignored` |
| 3 | `POST /api/gateway/data` (SOS alert) | `201 { success: true, id: N }` |
| 4 | `GET /api/alerts/sos` | SOS event appears in the list |
| 5 | `POST /api/gateway/warning` (set) | `200 { ok: true }` |
| 6 | `POST /api/gateway/warning` (clear) | `200 { ok: true }` |

---

### Flow 6 — Invite system

| # | Request | Expected |
|---|---------|----------|
| 1 | `POST /api/auth/invites` | `201 { invite_token, link, expires_at }` |
| 2 | `GET /api/auth/invites/:token` | `200 { email, expires_at }` |
| 3 | `POST /api/auth/register` (with invite_token) | `201` — invite is consumed |
| 4 | `GET /api/auth/invites/:token` (same token) | `410 Invite already used` |

After step 1: copy `invite_token` → **`invite_token`** env variable.

---

### Flow 7 — Device management

| # | Request | Expected |
|---|---------|----------|
| 1 | `PATCH /api/devices/:id` (rename) | `200 { ok: true, name: "..." }` |
| 2 | `POST /api/devices/:id/revoke` | `200 { ok: true }` — token cleared |
| 3 | `POST /api/gateway/ping` (old token) | `401 Unauthorized` — token no longer valid |
| 4 | `POST /api/devices/:id/regen-code` | `200 { registration_code, expires_at }` |
| 5 | Re-register with new code (Flow 4 step 1) | `201 { token }` — device is live again |
| 6 | `DELETE /api/devices/:id` | `200 { ok: true }` |
| 7 | `GET /api/devices` | device no longer in list |

---

### Flow 8 — Authorization errors

All of these should return `401`:

| Request |
|---------|
| `GET /api/auth/me` (no token) |
| `GET /api/devices` (no token) |
| `GET /api/alerts/sos` (no token) |
| `POST /api/gateway/data` (no x-gateway-token) |
| `POST /api/gateway/data` (invalid x-gateway-token) |

---

### Flow 9 — Google OAuth (browser only)

> Requires `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`.

**Setup in Google Cloud Console:**

1. Go to [console.cloud.google.com](https://console.cloud.google.com/)
2. Create a project (or select existing)
3. **APIs & Services → OAuth consent screen** — fill in app name, support email
4. **APIs & Services → Credentials → Create credentials → OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Authorised redirect URI: `http://localhost:3001/api/auth/google/callback`
5. Copy Client ID and Client Secret into `.env`:
   ```
   GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
   ```
6. Restart the backend

**Testing:**

1. Open `http://localhost:3001/api/auth/google` in a browser → redirected to Google
2. Sign in with your Google account
3. After consent, browser redirects to `http://localhost:3000/login?token=...&user=...`
4. Frontend stores the token — you are logged in

**Linking existing account:**

- If you registered with the same email that Google returns, the accounts are linked automatically.
- After linking, both password login and Google login work for the same account.

---

## 4. Frontend Testing Checklist

Open `http://localhost:3000` after starting the frontend.

- [ ] `/login` — shows email + password form + "Sign in with Google" + "Create one" link
- [ ] Submit wrong password → shows error message
- [ ] Submit correct admin credentials → redirected to `/dashboard`
- [ ] `/register` — create a new account → redirected to `/devices`
- [ ] `/devices` — shows empty state with "+ Add Device" button
- [ ] Click "+ Add Device" → modal → fill name → submit → **code banner appears** with registration code
- [ ] Rename device → modal → updated name in table
- [ ] Simulate SOS (Insomnia Flow 5 step 3) → Dashboard SOS alert counter updates in real-time (WebSocket)
- [ ] Revoke token → device shows as needing re-registration
- [ ] Delete device → removed from table
- [ ] Sign out → redirected to `/login`, token cleared

---

## 5. WebSocket — real-time SOS alerts

You can verify the WebSocket broadcast works without a frontend:

```bash
# Install wscat globally if needed
npm install -g wscat

wscat -c ws://localhost:3001/ws
```

Leave the terminal open, then send an SOS via Insomnia (`POST /api/gateway/data` with `sos_alert: true`). You should see the event printed in the wscat terminal within milliseconds.

---

## 6. Troubleshooting

| Problem | Fix |
|---------|-----|
| `JWT_SECRET is not set` error | Make sure `.env` exists with `JWT_SECRET` filled in |
| `Cannot find module 'passport'` | Run `npm install` in `cloud/backend` |
| Google OAuth returns 503 | `GOOGLE_CLIENT_ID` not set in `.env` |
| Login works but frontend shows 401 | `jwt_token` env variable not pasted in Insomnia |
| Device registration code invalid | Code may have expired (24 h TTL) — use regen-code endpoint |
| `MIGRATION: Upgrading gateways table` in logs | Normal on first run after update — existing data is preserved |
