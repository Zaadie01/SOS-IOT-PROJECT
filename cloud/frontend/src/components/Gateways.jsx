import { useState, useEffect } from 'react';
import { fetchGateways } from '../services/api';

const INACTIVE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

function formatTs(ts) {
    if (!ts) return '—';
    const diffMs = Date.now() - ts;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1)  return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

function formatDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString();
}

export default function Gateways() {
    const [gateways, setGateways] = useState([]);
    const [loading, setLoading] = useState(true);
    const [lastRefresh, setLastRefresh] = useState(null);

    function refresh() {
        fetchGateways()
            .then(data => {
                setGateways(data);
                setLastRefresh(Date.now());
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }

    useEffect(() => {
        refresh();
        const id = setInterval(refresh, 30000);
        return () => clearInterval(id);
    }, []);

    // Re-render every 30s so relative timestamps update
    const [, tick] = useState(0);
    useEffect(() => {
        const id = setInterval(() => tick(n => n + 1), 30000);
        return () => clearInterval(id);
    }, []);

    return (
        <div className="gateways-page">
            <div className="gateways-header">
                <h2>Registered Gateways</h2>
                <div className="gateways-meta">
                    {lastRefresh && <span className="last-update">Updated {formatTs(lastRefresh)}</span>}
                    <button className="refresh-btn" onClick={refresh}>Refresh</button>
                </div>
            </div>

            {loading ? (
                <p className="no-data">Loading...</p>
            ) : gateways.length === 0 ? (
                <p className="no-data">No gateways registered yet.</p>
            ) : (
                <div className="gateway-cards">
                    {gateways.map(gw => {
                        const active = gw.last_seen_at && (Date.now() - gw.last_seen_at) < INACTIVE_THRESHOLD_MS;
                        return (
                            <div key={gw.gateway_id} className={`gateway-card ${active ? 'gw-active' : 'gw-inactive'}`}>
                                <div className="gw-card-header">
                                    <span className="gw-id">{gw.gateway_id}</span>
                                    <span className={`gw-badge ${active ? 'badge-active' : 'badge-inactive'}`}>
                                        {active ? 'Active' : 'Inactive'}
                                    </span>
                                </div>
                                <div className="gw-rows">
                                    <div className="gw-row">
                                        <span className="gw-label">Device</span>
                                        <span className="gw-value">{gw.device_id || '—'}</span>
                                    </div>
                                    <div className="gw-row">
                                        <span className="gw-label">Last ping</span>
                                        <span className={`gw-value ${active ? 'val-active' : 'val-inactive'}`}>
                                            {gw.last_seen_at ? formatTs(gw.last_seen_at) : 'never'}
                                        </span>
                                    </div>
                                    <div className="gw-row">
                                        <span className="gw-label">Last ping at</span>
                                        <span className="gw-value gw-value-sm">{formatDate(gw.last_seen_at)}</span>
                                    </div>
                                    <div className="gw-row">
                                        <span className="gw-label">Registered</span>
                                        <span className="gw-value gw-value-sm">{formatDate(gw.registered_at)}</span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
