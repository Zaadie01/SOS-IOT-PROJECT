const BASE_URL = '/api';

export async function fetchAlerts() {
    const res = await fetch(`${BASE_URL}/alerts/sos`);
    if (!res.ok) throw new Error('Failed to fetch alerts');
    const json = await res.json();
    return json.alerts;
}
