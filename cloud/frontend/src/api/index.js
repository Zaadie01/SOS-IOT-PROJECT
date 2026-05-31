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
