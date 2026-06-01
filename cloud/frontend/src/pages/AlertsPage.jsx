import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '@mdi/react';
import {
    mdiAlertCircleOutline, mdiBellOffOutline, mdiBellOutline, mdiBell, mdiRefresh,
} from '@mdi/js';
import { useAlertsContext }     from '../context/AlertsContext';
import { fetchDevices }         from '../api';
import DeviceFilter             from '../components/alerts/DeviceFilter';
import LastSosIndicator         from '../components/alerts/LastSosIndicator';
import { formatTime }           from '../utils/time';

const ITEMS_PER_PAGE = 25;

function buildPageRange(currentPage, totalPages) {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);

    const candidates = new Set(
        [1, totalPages, currentPage, currentPage - 1, currentPage + 1]
            .filter(p => p >= 1 && p <= totalPages)
    );
    const sorted = [...candidates].sort((a, b) => a - b);

    const result = [];
    for (let i = 0; i < sorted.length; i++) {
        if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push('…');
        result.push(sorted[i]);
    }
    return result;
}

// ── Notifications panel — UI only, no push logic ──────────────────────────────

function NotificationsPanel({ devices, prefs, updatePref }) {
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AlertsPage() {
    const { alerts, prefs, refresh, updatePref } = useAlertsContext();

    const [devices, setDevices]               = useState([]);
    const [searchParams, setSearchParams]     = useSearchParams();
    const [selectedDeviceId, setSelectedRaw]  = useState(() => {
        const param = searchParams.get('device');
        return param ? Number(param) : null;
    });
    const [currentPage, setCurrentPage]       = useState(1);
    const [showNotifPanel, setShowNotifPanel] = useState(false);
    const [isRefreshing, setRefreshing]       = useState(false);

    function selectDevice(id) {
        setSelectedRaw(id);
        if (id) setSearchParams({ device: id }, { replace: true });
        else    setSearchParams({},             { replace: true });
    }

    const loadDevices = useCallback(() => {
        fetchDevices()
            .then(list => {
                const registeredOnly = list.filter(d => d.status !== 'pending');
                setDevices(registeredOnly);
                if (selectedDeviceId && !registeredOnly.find(d => d.id === selectedDeviceId)) {
                    selectDevice(null);
                }
            })
            .catch(() => {});
    }, []); // eslint-disable-line

    // On mount: load devices + re-fetch alerts (removes stale rows from deleted devices)
    useEffect(() => {
        loadDevices();
        refresh();
    }, []); // eslint-disable-line

    useEffect(() => { setCurrentPage(1); }, [selectedDeviceId, alerts.length]);

    async function handleRefresh() {
        setRefreshing(true);
        try { await Promise.all([refresh(), loadDevices()]); }
        finally { setRefreshing(false); }
    }

    const filteredAlerts = useMemo(() =>
        selectedDeviceId
            ? alerts.filter(a => a.device_db_id === selectedDeviceId)
            : alerts,
        [alerts, selectedDeviceId]
    );

    const totalPages      = Math.ceil(filteredAlerts.length / ITEMS_PER_PAGE);
    const paginatedAlerts = filteredAlerts.slice(
        (currentPage - 1) * ITEMS_PER_PAGE,
        currentPage * ITEMS_PER_PAGE
    );
    const mostRecentAlert = filteredAlerts[0];

    return (
        <div className="container py-4">

            {/* Header row */}
            <div className="d-flex align-items-center justify-content-between mb-4 flex-wrap gap-3">
                <div className="d-flex align-items-center gap-3 flex-wrap">
                    <h5 className="fw-bold mb-0 d-flex align-items-center gap-2">
                        <Icon path={mdiAlertCircleOutline} size={0.9} color="#ef4444" />
                        SOS History
                        {alerts.length > 0 && (
                            <span className="badge bg-danger">{alerts.length}</span>
                        )}
                    </h5>

                    <LastSosIndicator
                        alert={mostRecentAlert}
                        totalCount={filteredAlerts.length}
                    />
                </div>

                <div className="d-flex align-items-center gap-2 flex-wrap">
                    <button
                        className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
                        onClick={handleRefresh}
                        disabled={isRefreshing}
                        title="Refresh alerts"
                    >
                        <Icon
                            path={mdiRefresh}
                            size={0.75}
                            style={isRefreshing
                                ? { animation: 'spin 0.7s linear infinite' }
                                : undefined}
                        />
                        Refresh
                    </button>

                    <button
                        className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
                        onClick={() => setShowNotifPanel(v => !v)}
                    >
                        <Icon path={mdiBellOutline} size={0.7} />
                        Notifications
                    </button>

                    {devices.length > 0 && (
                        <DeviceFilter
                            devices={devices}
                            value={selectedDeviceId}
                            onChange={selectDevice}
                        />
                    )}
                </div>
            </div>

            {/* Notification panel (collapsible, UI-only) */}
            {showNotifPanel && (
                <NotificationsPanel
                    devices={devices}
                    prefs={prefs}
                    updatePref={updatePref}
                />
            )}

            {/* Empty state */}
            {alerts.length === 0 ? (
                <div className="empty-state">
                    <Icon path={mdiBellOffOutline} size={3} color="#cbd5e1" />
                    <h6 className="mt-3 fw-semibold">No SOS alerts yet</h6>
                    <p className="small">Alerts will appear here when a device sends an SOS.</p>
                </div>
            ) : (
                <div className="card border-0 shadow-sm">
                    <div className="table-responsive">
                        <table className="table table-hover align-middle mb-0">
                            <thead className="table-light">
                                <tr>
                                    <th className="text-muted small fw-medium ps-4">#</th>
                                    <th className="text-muted small fw-medium">Device</th>
                                    <th className="text-muted small fw-medium">Device ID</th>
                                    <th className="text-muted small fw-medium">Owner</th>
                                    <th className="text-muted small fw-medium">Time</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paginatedAlerts.map((alert, index) => {
                                    const rowNumber = filteredAlerts.length - ((currentPage - 1) * ITEMS_PER_PAGE + index);
                                    return (
                                        <tr key={alert.id}>
                                            <td className="ps-4 text-muted small">{rowNumber}</td>
                                            <td className="fw-medium">{alert.device_name || '—'}</td>
                                            <td className="text-muted small">
                                                {alert.device_db_id ? `#${alert.device_db_id}` : '—'}
                                            </td>
                                            <td className="text-muted small">{alert.owner_name || '—'}</td>
                                            <td className="text-muted small">{formatTime(alert.timestamp)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {filteredAlerts.length === 0 && (
                        <div className="text-center py-4 text-muted small">
                            No alerts for this device
                        </div>
                    )}

                    {totalPages > 1 && (
                        <div className="d-flex align-items-center justify-content-between px-3 py-2 border-top">
                            <span className="text-muted small">
                                {(currentPage - 1) * ITEMS_PER_PAGE + 1}–
                                {Math.min(currentPage * ITEMS_PER_PAGE, filteredAlerts.length)} of{' '}
                                {filteredAlerts.length}
                            </span>
                            <nav>
                                <ul className="pagination pagination-sm mb-0">
                                    <li className={`page-item ${currentPage === 1 ? 'disabled' : ''}`}>
                                        <button className="page-link" onClick={() => setCurrentPage(1)}>«</button>
                                    </li>
                                    <li className={`page-item ${currentPage === 1 ? 'disabled' : ''}`}>
                                        <button className="page-link" onClick={() => setCurrentPage(p => p - 1)}>‹</button>
                                    </li>
                                    {buildPageRange(currentPage, totalPages).map((page, i) =>
                                        page === '…'
                                            ? <li key={`gap-${i}`} className="page-item disabled"><span className="page-link">…</span></li>
                                            : <li key={page} className={`page-item ${page === currentPage ? 'active' : ''}`}>
                                                <button className="page-link" onClick={() => setCurrentPage(page)}>{page}</button>
                                              </li>
                                    )}
                                    <li className={`page-item ${currentPage === totalPages ? 'disabled' : ''}`}>
                                        <button className="page-link" onClick={() => setCurrentPage(p => p + 1)}>›</button>
                                    </li>
                                    <li className={`page-item ${currentPage === totalPages ? 'disabled' : ''}`}>
                                        <button className="page-link" onClick={() => setCurrentPage(totalPages)}>»</button>
                                    </li>
                                </ul>
                            </nav>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
