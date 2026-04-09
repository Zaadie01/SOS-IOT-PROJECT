// api.js
const BASE_URL = '/api';

export async function fetchAlerts() {
    const res = await fetch(`${BASE_URL}/alerts/sos`);
    if (!res.ok) throw new Error('Failed to fetch alerts');
    const json = await res.json();
    return json.alerts;
}

export async function fetchGateways() {
    const res = await fetch(`${BASE_URL}/gateways`);
    if (!res.ok) throw new Error('Failed to fetch gateways');
    const json = await res.json();
    return json.gateways;
}

export async function fetchGateway(gatewayId) {
    const res = await fetch(`${BASE_URL}/gateways/${encodeURIComponent(gatewayId)}`);
    if (!res.ok) throw new Error('Failed to fetch gateway');
    const json = await res.json();
    return json.gateway;
}
