export default function SOSAlert({ alerts }) {
    if (!alerts || alerts.length === 0) {
        return (
            <section className="sos-section no-alerts">
                <h2>SOS Alerts</h2>
                <p>No SOS alerts — system nominal</p>
            </section>
        );
    }

    return (
        <section className="sos-section has-alerts">
            <h2>🚨 SOS ALERTS — {alerts.length} total</h2>
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
