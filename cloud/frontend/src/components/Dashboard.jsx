export default function Dashboard({ alerts }) {
    const uniqueDevices = new Set(alerts.map(a => a.device_id)).size;

    return (
        <section className="dashboard">
            <h2>SOS History</h2>

            <div className="stats-grid">
                <div className="stat-card alert-stat">
                    <div className="stat-value">{alerts.length}</div>
                    <div className="stat-label">Total SOS Events</div>
                </div>
                <div className="stat-card">
                    <div className="stat-value">{uniqueDevices}</div>
                    <div className="stat-label">Active Devices</div>
                </div>
            </div>

            <h3>Event Log</h3>
            {alerts.length === 0 ? (
                <p className="no-data">No SOS events yet — waiting for alerts...</p>
            ) : (
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>Time</th>
                            <th>Device</th>
                            <th>Clicks</th>
                            <th>Gateway</th>
                        </tr>
                    </thead>
                    <tbody>
                        {alerts.slice(0, 20).map(row => (
                            <tr key={row.id} className="sos-row">
                                <td>{new Date(row.timestamp).toLocaleString()}</td>
                                <td>{row.device_id}</td>
                                <td>{row.button_pressed}</td>
                                <td>{row.gateway_id}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </section>
    );
}
