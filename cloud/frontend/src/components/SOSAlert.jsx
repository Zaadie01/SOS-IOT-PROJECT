// SOSAlert.jsx
import { useState, useEffect } from 'react';

const RECENT_MS = 5 * 60 * 1000;

export default function SOSAlert({ alerts }) {
    const [, setTick] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => setTick(t => t + 1), 30_000);
        return () => clearInterval(interval);
    }, []);

    if (!alerts || alerts.length === 0) {
        return (
            <section className="sos-section no-alerts">
                <h2>SOS Alerts</h2>
                <p>No SOS alerts — system nominal</p>
            </section>
        );
    }

    const recentAlerts = alerts.filter(a => Date.now() - a.timestamp < RECENT_MS);

    const newestTs = recentAlerts.length > 0
        ? Math.max(...recentAlerts.map(a => a.timestamp))
        : null;
    const expiresIn = newestTs !== null ? newestTs + RECENT_MS - Date.now() : null;

    return (
        <section className={`sos-section ${recentAlerts.length > 0 ? 'has-alerts' : 'no-alerts'}`}>
            <h2>
                {recentAlerts.length > 0 ? `🚨 SOS ALERTS — ${recentAlerts.length} recent` : 'Awaiting SOS signals...'}
                {expiresIn !== null && (
                    <span style={{ fontSize: '0.6em', color: '#888', fontWeight: 'normal', marginLeft: '0.75em' }}>
                        expires in {Math.max(1, Math.ceil(expiresIn / 60_000))} min
                    </span>
                )}
            </h2>
            {recentAlerts.length > 0 && (
                <div className="alerts-list">
                    {recentAlerts.map(alert => (
                        <div key={alert.id} className="alert-item">
                            <span className="alert-device">{alert.device_id}</span>
                            <span className="alert-time">
                                {new Date(alert.timestamp).toLocaleString()}
                            </span>
                            <span className="alert-gateway">via {alert.gateway_id}</span>
                            <span className="alert-clicks">{alert.button_pressed} clicks</span>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}
