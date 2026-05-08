const BASE_URL = '/api';
const TOKEN_KEY = 'sos_auth_token';
const USER_KEY = 'sos_auth_user';

function authHeaders() {
    const token = localStorage.getItem(TOKEN_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch(path, options = {}) {
    const res = await fetch(`${BASE_URL}${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...authHeaders(), ...options.headers },
    });
    if (res.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        window.location.href = '/login';
        throw new Error('Unauthorized');
    }
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function login(email, password) {
    const res = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Login failed');
    }
    return res.json();
}

export async function fetchAlerts() {
    const json = await apiFetch('/alerts/sos');
    return json.alerts;
}

export async function fetchGateways() {
    const json = await apiFetch('/gateways');
    return json.gateways;
}

export async function fetchGateway(gatewayId) {
    const json = await apiFetch(`/gateways/${encodeURIComponent(gatewayId)}`);
    return json.gateway;
}
