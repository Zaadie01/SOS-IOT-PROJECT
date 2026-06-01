const BASE_URL = '/api';
const TOKEN_KEY = 'sos_auth_token';
const USER_KEY  = 'sos_auth_user';

// ── Core fetch wrapper ────────────────────────────────────────────────────────

function getStoredToken() {
    return localStorage.getItem(TOKEN_KEY);
}

/**
 * Sends a fetch request to the backend API.
 *
 * - Attaches `Authorization: Bearer <token>` when a token is stored.
 * - On 401: throws the server error message directly so login/register
 *   forms can display it. Only forces a page redirect if the user had
 *   a previously stored token (expired session).
 */
async function apiFetch(path, options = {}) {
    const storedToken = getStoredToken();

    const res = await fetch(`${BASE_URL}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(storedToken ? { Authorization: `Bearer ${storedToken}` } : {}),
            ...options.headers,
        },
    });

    if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        const errorMessage = json.error || `API error ${res.status}`;

        // Only force-logout when a previously authenticated session has expired
        if (res.status === 401 && storedToken) {
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(USER_KEY);
            window.location.href = '/login';
        }

        throw new Error(errorMessage);
    }

    return res.json();
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export function login(email, password) {
    return apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
    });
}

export function register(email, password, name) {
    return apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name }),
    });
}

// ── Devices ───────────────────────────────────────────────────────────────────

export async function fetchDevices() {
    const json = await apiFetch('/devices');
    return json.devices;
}

export function createDevice(name) {
    return apiFetch('/devices', {
        method: 'POST',
        body: JSON.stringify({ name }),
    });
}

export function renameDevice(id, name) {
    return apiFetch(`/devices/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
    });
}

export function deleteDevice(id) {
    return apiFetch(`/devices/${id}`, { method: 'DELETE' });
}

// ── Alerts ────────────────────────────────────────────────────────────────────

export async function fetchAlerts() {
    const json = await apiFetch('/alerts/sos');
    return json.alerts;
}

// ── Invitations (owner side) ──────────────────────────────────────────────────

export function createInvitation(deviceId, payload) {
    return apiFetch(`/devices/${deviceId}/invitations`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export async function listDeviceInvitations(deviceId) {
    const json = await apiFetch(`/devices/${deviceId}/invitations`);
    return json.invitations;
}

export function revokeInvitation(invitationId) {
    return apiFetch(`/invitations/${invitationId}/revoke`, { method: 'POST' });
}

export function deleteInvitation(invitationId) {
    return apiFetch(`/invitations/${invitationId}`, { method: 'DELETE' });
}

// ── Invitations (invitee side) ────────────────────────────────────────────────

export async function getReceivedInvitations() {
    const json = await apiFetch('/invitations/received');
    return json.invitations;
}

export function acceptInvitation(invitationId) {
    return apiFetch(`/invitations/${invitationId}/accept`, { method: 'POST' });
}

export function declineInvitation(invitationId) {
    return apiFetch(`/invitations/${invitationId}/decline`, { method: 'POST' });
}

// ── Notification prefs ────────────────────────────────────────────────────────

export async function getNotificationPrefs() {
    const json = await apiFetch('/notifications');
    return json.prefs;
}

export function setNotificationPref(deviceId, enabled) {
    return apiFetch(`/notifications/${deviceId}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
    });
}
