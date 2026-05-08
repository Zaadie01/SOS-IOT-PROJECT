import { useState, useEffect } from 'react';
import { fetchAlerts } from '../services/api';

export function useAlerts(token) {
    const [alerts, setAlerts] = useState([]);

    useEffect(() => {
        if (!token) return;
        fetchAlerts()
            .then(data => setAlerts(data))
            .catch(() => {});
    }, [token]);

    useEffect(() => {
        if (!token) return;
        let ws;
        let retryTimeout;
        let destroyed = false;

        function connect() {
            if (destroyed) return;
            clearTimeout(retryTimeout);
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

            ws.onclose = () => {
                if (!destroyed) retryTimeout = setTimeout(connect, 3000);
            };
            ws.onmessage = (e) => {
                try {
                    const msg = JSON.parse(e.data);
                    if (msg.type === 'sos') {
                        setAlerts(prev => [msg.event, ...prev]);
                    }
                } catch (err) {
                    console.error('[WS] Failed to parse message:', err);
                }
            };
        }

        window.addEventListener('online', connect);
        window.addEventListener('offline', () => ws?.close());

        connect();
        return () => {
            destroyed = true;
            clearTimeout(retryTimeout);
            window.removeEventListener('online', connect);
            ws?.close();
        };
    }, [token]);

    return alerts;
}
