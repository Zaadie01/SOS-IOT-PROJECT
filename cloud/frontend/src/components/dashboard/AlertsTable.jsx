export default function AlertsTable({ alerts }) {
    if (alerts.length === 0) {
        return <p className="no-data">No SOS events yet — waiting for alerts...</p>;
    }

    return (
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
    );
}
