// SOSAlert.jsx
const RECENT_MS = 5 * 60 * 1000;

export default function SOSAlert({ alerts }) {
    if (!alerts || alerts.length === 0) {
        return (
            <section className="sos-section no-alerts">
                <h2>SOS Alerts</h2>
                <p>No SOS alerts — system nominal</p>
            </section>
        );
    }

    const recentAlerts = alerts.filter(a => Date.now() - a.timestamp < RECENT_MS);

    return (
        <section className={`sos-section ${recentAlerts.length > 0 ? 'has-alerts' : 'no-alerts'}`}>
            <h2>
                {recentAlerts.length > 0 ? '🚨 SOS ALERTS' : 'SOS Alerts'}
                {' — '}{alerts.length} total{recentAlerts.length > 0 ? `, ${recentAlerts.length} recent` : ''}
            </h2>
            <div className="alerts-list">
                {alerts.slice(0, 5).map(alert => (
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
        </section>
    );
}
