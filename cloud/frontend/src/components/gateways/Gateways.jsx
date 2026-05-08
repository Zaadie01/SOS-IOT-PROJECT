import { useState, useEffect } from 'react';
import { fetchGateways } from '../../services/api';
import { formatTs } from '../../utils/time';
import GatewayList from './GatewayList';

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
                    <span className="last-update">Auto-updates every 30s</span>
                    {lastRefresh && <span className="last-update">· Updated {formatTs(lastRefresh)}</span>}
                    <button className="refresh-btn" onClick={refresh}>Refresh</button>
                </div>
            </div>
            <GatewayList gateways={gateways} loading={loading} />
        </div>
    );
}
