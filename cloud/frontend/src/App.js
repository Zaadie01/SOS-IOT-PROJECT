import { useState, useEffect } from 'react';
import { fetchAlerts } from './services/api';
import SOSAlert from './components/SOSAlert';
import Dashboard from './components/Dashboard';
import './App.css';

function App() {
    const [alerts, setAlerts] = useState([]);
    const [connected, setConnected] = useState(false);
    const [wsConnected, setWsConnected] = useState(false);

    // Initial load of historical alerts
    useEffect(() => {
        fetchAlerts()
            .then(data => { setAlerts(data); setConnected(true); })
            .catch(() => setConnected(false));
    }, []);

    // WebSocket for real-time SOS events
    useEffect(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

        ws.onopen = () => setWsConnected(true);
        ws.onclose = () => setWsConnected(false);

        ws.onmessage = (e) => {
            const msg = JSON.parse(e.data);
            if (msg.type === 'sos') {
                setAlerts(prev => [msg.event, ...prev]);
            }
        };

        return () => ws.close();
    }, []);

    return (
        <div className="app">
            <header className="app-header">
                <h1>SOS IoT Dashboard</h1>
                <div className={`status ${wsConnected ? 'connected' : 'disconnected'}`}>
                    {wsConnected ? 'Live' : 'Disconnected'}
                </div>
                <div className={`status ${connected ? 'connected' : 'disconnected'}`} style={{ marginLeft: '0.5rem' }}>
                    {connected ? 'API OK' : 'API Error'}
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
