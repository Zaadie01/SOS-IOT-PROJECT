import { formatTs, formatDate } from '../../utils/time';

const INACTIVE_THRESHOLD_MS = 5 * 60 * 1000;

export default function GatewayCard({ gw }) {
    const active = gw.last_seen_at && (Date.now() - gw.last_seen_at) < INACTIVE_THRESHOLD_MS;
    const hasWarning = !!gw.warning;
    const cardClass = hasWarning ? 'gw-warning' : active ? 'gw-active' : 'gw-inactive';
    const badgeClass = hasWarning ? 'badge-warning' : active ? 'badge-active' : 'badge-inactive';
    const badgeText = hasWarning ? 'Warning' : active ? 'Active' : 'Inactive';

    return (
        <div className={`gateway-card ${cardClass}`}>
            <div className="gw-card-header">
                <span className="gw-id">{gw.gateway_id}</span>
                <span className={`gw-badge ${badgeClass}`}>{badgeText}</span>
            </div>
            {hasWarning && <div className="gw-warning-msg">{gw.warning}</div>}
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
}
