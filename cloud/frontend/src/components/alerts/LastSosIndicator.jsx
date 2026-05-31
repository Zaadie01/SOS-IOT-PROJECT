import { useState, useEffect } from 'react';
import Icon from '@mdi/react';
import { mdiAlertCircleOutline } from '@mdi/js';
import { formatTime } from '../../utils/time';

const RECENT_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const RECHECK_INTERVAL_MS = 30 * 1000;      // re-render every 30 s to update colour

/**
 * Shows the timestamp of the last SOS alert.
 * Displays in red with a blinking icon while the alert is recent (< 5 min old).
 */
export default function LastSosIndicator({ alert, totalCount }) {
    const [, forceUpdate] = useState(0);

    useEffect(() => {
        const timer = setInterval(() => forceUpdate(n => n + 1), RECHECK_INTERVAL_MS);
        return () => clearInterval(timer);
    }, []);

    if (!alert) return null;

    const isRecent = (Date.now() - alert.synced_at) < RECENT_THRESHOLD_MS;

    const containerStyle = isRecent
        ? { border: '1.5px solid #ef4444', color: '#ef4444', background: '#fff5f5' }
        : { border: '1.5px solid #e2e8f0', color: '#1e293b', background: '#fff' };

    return (
        <span
            className="rounded px-3 py-1 small fw-medium d-inline-flex align-items-center gap-2"
            style={containerStyle}
        >
            {isRecent && <Icon path={mdiAlertCircleOutline} size={0.65} color="#ef4444" />}
            Last: <strong>{alert.device_name}</strong> #{totalCount} — {formatTime(alert.timestamp)}
        </span>
    );
}
