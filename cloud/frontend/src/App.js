// App.js
import { useState, useEffect } from 'react';
import { fetchAlerts } from './services/api';
import SOSAlert from './components/SOSAlert';
import Dashboard from './components/Dashboard';
import Gateways from './components/Gateways';
import './App.css';

function App() {
    const [alerts, setAlerts] = useState([]);
    const [page, setPage] = useState('dashboard'); // 'dashboard' | 'gateways'

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
    }, []);

    return (
        <div className="app">
            <header className="app-header">
                <h1>SOS IoT Dashboard</h1>
                <nav className="app-nav">
                    <button
                        className={`nav-tab ${page === 'dashboard' ? 'nav-tab-active' : ''}`}
                        onClick={() => setPage('dashboard')}
                    >
                        Dashboard
                    </button>
                    <button
                        className={`nav-tab ${page === 'gateways' ? 'nav-tab-active' : ''}`}
                        onClick={() => setPage('gateways')}
                    >
                        Gateways
                    </button>
                </nav>
            </header>
            <main>
                {page === 'dashboard' && (
                    <>
                        <SOSAlert alerts={alerts} />
                        <Dashboard alerts={alerts} />
                    </>
                )}
                {page === 'gateways' && <Gateways />}
            </main>
        </div>
    );
}

export default App;
