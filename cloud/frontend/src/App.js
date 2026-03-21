// App.js
import { useState, useEffect } from 'react';
import { fetchAlerts, fetchGateways } from './services/api';
import SOSAlert from './components/SOSAlert';
import Dashboard from './components/Dashboard';
import './App.css';

function formatLastSeen(ts) {
    if (!ts) return 'never';
    const diffMs = Date.now() - ts;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1)  return 'just now';
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
}

function App() {
    const [alerts, setAlerts] = useState([]);
    const [wsConnected, setWsConnected] = useState(false);
    const [gatewayLastSeen, setGatewayLastSeen] = useState(null);

    // Initial load of historical alerts
    useEffect(() => {
        fetchAlerts()
            .then(data => setAlerts(data))
            .catch(() => {});
    }, []);

    // WebSocket for real-time SOS events (with auto-reconnect)
    useEffect(() => {
        let ws;
        let retryTimeout;
        let destroyed = false;

        function pollGateway() {
            fetchGateways()
                .then(gateways => {
                    const latest = gateways.reduce((max, g) =>
                        (g.last_seen_at > (max?.last_seen_at ?? 0) ? g : max), null);
                    setGatewayLastSeen(latest?.last_seen_at ?? null);
                })
                .catch(() => {});
        }

        pollGateway();
        const gatewayPollId = setInterval(pollGateway, 30000);

        function connect() {
            if (destroyed) return;
            clearTimeout(retryTimeout);
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

            ws.onopen = () => setWsConnected(true);
            ws.onclose = () => {
                setWsConnected(false);
                if (!destroyed) retryTimeout = setTimeout(connect, 3000);
            };
            ws.onmessage = (e) => {
                try {
                    const msg = JSON.parse(e.data);
                    if (msg.type === 'sos') {
                        setAlerts(prev => [msg.event, ...prev]);
                        pollGateway(); // обновить "last seen" сразу при новом событии
                    }
                } catch (err) {
                    console.error('[WS] Failed to parse message:', err);
                }
            };
        }

        function handleOffline() {
            setWsConnected(false);
            ws?.close();
        }
        function handleOnline() {
            connect();
        }

        window.addEventListener('offline', handleOffline);
        window.addEventListener('online', handleOnline);

        connect();
        return () => {
            destroyed = true;
            clearTimeout(retryTimeout);
            clearInterval(gatewayPollId);
            window.removeEventListener('offline', handleOffline);
            window.removeEventListener('online', handleOnline);
            ws?.close();
        };
    }, []);

    return (
        <div className="app">
            <header className="app-header">
                <h1>SOS IoT Dashboard</h1>
                <div className={`status ${wsConnected ? 'connected' : 'disconnected'}`}>
                    {wsConnected ? 'Live' : 'Disconnected'}
                </div>
                <div className={`status ${gatewayLastSeen && Date.now() - gatewayLastSeen < 5 * 60000 ? 'connected' : 'disconnected'}`} style={{ marginLeft: '0.5rem' }}>
                    Gateway: {formatLastSeen(gatewayLastSeen)}
                </div>
            </header>
            <main>
                <SOSAlert alerts={alerts} />
                <Dashboard alerts={alerts} />
            </main>
        </div>
    );
}

export default App;
