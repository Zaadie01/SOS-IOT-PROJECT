import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '@mdi/react';
import { mdiAlertCircleOutline, mdiBellOffOutline, mdiChevronDown, mdiClose } from '@mdi/js';
import { useAlerts } from '../hooks/useAlerts';
import { useAuth } from '../context/AuthContext';
import { fetchDevices } from '../services/api';

const RECENT_MS = 5 * 60 * 1000;

function formatTime(ms) {
    if (!ms) return '—';
    const d = new Date(ms);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const date = d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' });
    return `${time}, ${date}`;
}

// ── Pagination helpers ────────────────────────────────────────────────────────
function pageRange(current, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages = new Set([1, total, current, current - 1, current + 1].filter(p => p >= 1 && p <= total));
    const sorted = [...pages].sort((a, b) => a - b);
    const result = [];
    for (let i = 0; i < sorted.length; i++) {
        if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push('…');
        result.push(sorted[i]);
    }
    return result;
}

// ── Searchable device dropdown ────────────────────────────────────────────────
function DeviceFilter({ devices, value, onChange }) {
    const [open, setOpen]     = useState(false);
    const [search, setSearch] = useState('');
    const ref                 = useRef(null);

    useEffect(() => {
        function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const filtered = devices.filter(d => {
        if (!search) return true;
        const q = search.toLowerCase();
        return d.name?.toLowerCase().includes(q) || String(d.id).includes(q);
    });

    const selected = devices.find(d => d.id === value);
    const label    = value
        ? (selected ? `${selected.name} (#${selected.id})` : `#${value}…`)
        : 'All devices';

    function select(id) { onChange(id); setOpen(false); setSearch(''); }

    return (
        <div ref={ref} className="position-relative" style={{ minWidth: 230 }}>
            <div
                className={`form-control form-control-sm d-flex align-items-center justify-content-between gap-2 ${value ? 'border-primary text-primary' : 'text-secondary'}`}
                style={{ cursor: 'pointer', userSelect: 'none', borderWidth: value ? 2 : 1 }}
                onClick={() => setOpen(o => !o)}
            >
                <span className="text-truncate">{label}</span>
                <div className="d-flex align-items-center gap-1 flex-shrink-0">
                    {value && (
                        <span onClick={e => { e.stopPropagation(); select(null); }} style={{ cursor: 'pointer', lineHeight: 1 }}>
                            <Icon path={mdiClose} size={0.6} color="#94a3b8" />
                        </span>
                    )}
                    <Icon path={mdiChevronDown} size={0.7} color="#94a3b8" />
                </div>
            </div>

            {open && (
                <div className="position-absolute w-100 bg-white border rounded shadow mt-1" style={{ zIndex: 1000, maxHeight: 280, overflowY: 'auto' }}>
                    <div className="p-2 border-bottom sticky-top bg-white">
                        <input
                            type="text"
                            className="form-control form-control-sm"
                            placeholder="Search by name or ID…"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            autoFocus
                            onClick={e => e.stopPropagation()}
                        />
                    </div>
                    <div
                        className={`px-3 py-2 small ${!value ? 'fw-semibold bg-light' : 'text-muted'}`}
                        style={{ cursor: 'pointer' }}
                        onClick={() => select(null)}
                    >
                        All devices
                    </div>
                    {filtered.map(d => (
                        <div
                            key={d.id}
                            className={`px-3 py-2 small d-flex justify-content-between ${value === d.id ? 'fw-semibold bg-light' : ''}`}
                            style={{ cursor: 'pointer' }}
                            onClick={() => select(d.id)}
                            onMouseEnter={e => { if (value !== d.id) e.currentTarget.style.background = '#f8fafc'; }}
                            onMouseLeave={e => { if (value !== d.id) e.currentTarget.style.background = ''; }}
                        >
                            <span>{d.name}</span>
                            <span className="text-muted ms-2">#{d.id}</span>
                        </div>
                    ))}
                    {filtered.length === 0 && (
                        <div className="px-3 py-2 small text-muted">No devices found</div>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Last SOS indicator ────────────────────────────────────────────────────────
function LastSosIndicator({ alert, totalCount }) {
    const [, setTick] = useState(0);

    // Re-render every 30 s so the colour updates when 5 min passes
    useEffect(() => {
        const id = setInterval(() => setTick(t => t + 1), 30_000);
        return () => clearInterval(id);
    }, []);

    if (!alert) return null;

    const isRecent = (Date.now() - alert.synced_at) < RECENT_MS;

    const style = isRecent
        ? { border: '1.5px solid #ef4444', color: '#ef4444', background: '#fff5f5' }
        : { border: '1.5px solid #e2e8f0', color: '#1e293b', background: '#fff' };

    return (
        <span
            className="rounded px-3 py-1 small fw-medium d-inline-flex align-items-center gap-2"
            style={style}
        >
            {isRecent && <Icon path={mdiAlertCircleOutline} size={0.65} color="#ef4444" />}
            Last: <strong>{alert.device_name}</strong> #{totalCount} — {formatTime(alert.timestamp)}
        </span>
    );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AlertsPage() {
    const { token }                   = useAuth();
    const alerts                      = useAlerts(token);
    const [devices, setDevices]       = useState([]);
    const [searchParams, setSearchParams] = useSearchParams();
    const [selectedDevice, setSelectRaw]  = useState(() => {
        const p = searchParams.get('device');
        return p ? Number(p) : null;
    });

    function setSelect(id) {
        setSelectRaw(id);
        if (id) setSearchParams({ device: id }, { replace: true });
        else setSearchParams({}, { replace: true });
    }

    useEffect(() => {
        fetchDevices()
            .then(list => {
                const registered = list.filter(d => d.status !== 'pending');
                setDevices(registered);
                // If the device from URL doesn't belong to the user — clear the filter
                if (selectedDevice && !registered.find(d => d.id === selectedDevice)) {
                    setSelect(null);
                }
            })
            .catch(() => {});
    }, []); // eslint-disable-line

    const ITEMS_PER_PAGE = 25;
    const [page, setPage] = useState(1);

    // Reset to page 1 when filter or alerts change
    useEffect(() => setPage(1), [selectedDevice, alerts.length]);

    const filtered = useMemo(() =>
        selectedDevice ? alerts.filter(a => a.device_db_id === selectedDevice) : alerts,
        [alerts, selectedDevice]
    );

    const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
    const paginated  = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

    const lastAlert = filtered[0];

    return (
        <div className="container py-4">
            <div className="d-flex align-items-center justify-content-between mb-4 flex-wrap gap-3">
                <div className="d-flex align-items-center gap-3 flex-wrap">
                    <h5 className="fw-bold mb-0 d-flex align-items-center gap-2">
                        <Icon path={mdiAlertCircleOutline} size={0.9} color="#ef4444" />
                        SOS History
                        {alerts.length > 0 && (
                            <span className="badge bg-danger">{alerts.length}</span>
                        )}
                    </h5>

                    <LastSosIndicator alert={lastAlert} totalCount={filtered.length} />
                </div>

                {devices.length > 0 && (
                    <DeviceFilter devices={devices} value={selectedDevice} onChange={setSelect} />
                )}
            </div>

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
                                    <th className="text-muted small fw-medium">Time</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paginated.map((alert, i) => (
                                    <tr key={alert.id}>
                                        <td className="ps-4 text-muted small">{filtered.length - ((page - 1) * ITEMS_PER_PAGE + i)}</td>
                                        <td className="fw-medium">{alert.device_name || '—'}</td>
                                        <td className="text-muted small">
                                            {alert.device_db_id ? `#${alert.device_db_id}` : '—'}
                                        </td>
                                        <td className="text-muted small">{formatTime(alert.timestamp)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {filtered.length === 0 && (
                        <div className="text-center py-4 text-muted small">
                            No alerts for this device
                        </div>
                    )}

                    {totalPages > 1 && (
                        <div className="d-flex align-items-center justify-content-between px-3 py-2 border-top">
                            <span className="text-muted small">
                                {(page - 1) * ITEMS_PER_PAGE + 1}–{Math.min(page * ITEMS_PER_PAGE, filtered.length)} of {filtered.length}
                            </span>
                            <nav>
                                <ul className="pagination pagination-sm mb-0">
                                    <li className={`page-item ${page === 1 ? 'disabled' : ''}`}>
                                        <button className="page-link" onClick={() => setPage(1)}>«</button>
                                    </li>
                                    <li className={`page-item ${page === 1 ? 'disabled' : ''}`}>
                                        <button className="page-link" onClick={() => setPage(p => p - 1)}>‹</button>
                                    </li>
                                    {pageRange(page, totalPages).map((p, i) =>
                                        p === '…'
                                            ? <li key={`e${i}`} className="page-item disabled"><span className="page-link">…</span></li>
                                            : <li key={p} className={`page-item ${p === page ? 'active' : ''}`}>
                                                <button className="page-link" onClick={() => setPage(p)}>{p}</button>
                                              </li>
                                    )}
                                    <li className={`page-item ${page === totalPages ? 'disabled' : ''}`}>
                                        <button className="page-link" onClick={() => setPage(p => p + 1)}>›</button>
                                    </li>
                                    <li className={`page-item ${page === totalPages ? 'disabled' : ''}`}>
                                        <button className="page-link" onClick={() => setPage(totalPages)}>»</button>
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
