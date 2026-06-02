import { useState, useEffect, useMemo } from 'react';
import Icon from '@mdi/react';
import { mdiBell, mdiBellOutline } from '@mdi/js';
import { formatTime } from '../../utils/time';

export default function NotificationsPanel({ devices, prefs, updatePref }) {
    const [permission, setPermission] = useState(() => Notification.permission);
    const [masterOn, setMasterOn]     = useState(() =>
        Notification.permission === 'granted' && Object.values(prefs).some(Boolean)
    );
    const [search, setSearch] = useState('');

    // Sync masterOn if prefs arrive after mount
    useEffect(() => {
        if (permission === 'granted' && Object.values(prefs).some(Boolean)) {
            setMasterOn(true);
        }
    }, [prefs, permission]);

    async function requestPermission() {
        const result = await Notification.requestPermission();
        setPermission(result);
        if (result === 'granted') setMasterOn(true);
    }

    const registeredDevices = devices.filter(d => d.status !== 'pending');

    const visibleDevices = useMemo(() => {
        if (!search.trim()) return registeredDevices;
        const q = search.toLowerCase();
        return registeredDevices.filter(d =>
            d.name?.toLowerCase().includes(q) || String(d.id).includes(q)
        );
    }, [registeredDevices, search]); // eslint-disable-line

    return (
        <div className="card border-0 shadow-sm mb-4">
            <div className="card-header bg-white border-bottom d-flex align-items-center gap-2 py-2">
                <Icon path={mdiBell} size={0.75} />
                <span className="fw-medium small">Push Notifications</span>
            </div>
            <div className="card-body py-3">
                {permission === 'denied' ? (
                    <p className="text-muted small mb-0">
                        Notifications are blocked by your browser. Enable them in browser settings.
                    </p>
                ) : permission !== 'granted' ? (
                    <div className="d-flex align-items-center gap-3">
                        <p className="text-muted small mb-0">Enable browser notifications to get SOS alerts.</p>
                        <button className="btn btn-outline-primary btn-sm" onClick={requestPermission}>
                            <Icon path={mdiBellOutline} size={0.65} className="me-1" />
                            Enable
                        </button>
                    </div>
                ) : (
                    <>
                        <div className="form-check form-switch mb-2">
                            <input
                                className="form-check-input"
                                type="checkbox"
                                id="master-notif"
                                checked={masterOn}
                                onChange={e => setMasterOn(e.target.checked)}
                            />
                            <label className="form-check-label small fw-medium" htmlFor="master-notif">
                                Notifications enabled
                            </label>
                        </div>
                        {masterOn && registeredDevices.length > 0 && (
                            <div className="ps-2">
                                <input
                                    type="text"
                                    className="form-control form-control-sm mb-2"
                                    placeholder="Filter devices…"
                                    value={search}
                                    onChange={e => setSearch(e.target.value)}
                                />
                                <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                                    {visibleDevices.map(d => (
                                        <div key={d.id} className="form-check form-switch mb-1">
                                            <input
                                                className="form-check-input"
                                                type="checkbox"
                                                id={`notif-${d.id}`}
                                                checked={Boolean(prefs[d.id])}
                                                onChange={e => updatePref(d.id, e.target.checked)}
                                            />
                                            <label
                                                className="form-check-label small"
                                                htmlFor={`notif-${d.id}`}
                                            >
                                                {d.name}
                                                {!d.is_owner && (
                                                    <span className="text-muted ms-1" style={{ fontSize: '0.7rem' }}>
                                                        ({d.owner_name})
                                                    </span>
                                                )}
                                            </label>
                                        </div>
                                    ))}
                                    {visibleDevices.length === 0 && (
                                        <p className="text-muted small mb-0">No devices match.</p>
                                    )}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
