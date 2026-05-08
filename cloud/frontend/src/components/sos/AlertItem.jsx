export default function AlertItem({ alert }) {
    return (
        <div className="alert-item">
            <span className="alert-device">{alert.device_id}</span>
            <span className="alert-time">{new Date(alert.timestamp).toLocaleString()}</span>
            <span className="alert-gateway">via {alert.gateway_id}</span>
            <span className="alert-clicks">{alert.button_pressed} clicks</span>
        </div>
    );
}
