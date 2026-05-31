import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '@mdi/react';
import {
    mdiPlus, mdiPencilOutline, mdiTrashCanOutline,
    mdiDevices, mdiAlertOutline, mdiAlertCircleOutline,
    mdiMagnify, mdiSort, mdiRefresh,
} from '@mdi/js';
import { fetchDevices, createDevice, renameDevice, deleteDevice } from '../api';
import StatusBadge from '../components/common/StatusBadge';
import DeviceModal from '../components/devices/DeviceModal';
import CodeBanner  from '../components/devices/CodeBanner';
import { formatTime } from '../utils/time';

export default function DevicesPage() {
    const navigate = useNavigate();

    const [devices, setDevices]         = useState([]);
    const [loading, setLoading]         = useState(true);   // true only on the very first load
    const [isRefreshing, setRefreshing] = useState(false);  // true during manual/auto refresh
    const [error, setError]             = useState('');
    const [showCreatedBanner, setBanner] = useState(false);
    const [activeModal, setModal]     = useState(null); // { mode, device? }
    const [search, setSearch]         = useState('');
    const [sortOrder, setSortOrder]   = useState('id-desc');
    const [statusFilter, setStatusFilter] = useState('any');

    const loadDevices = useCallback(async () => {
        try { setDevices(await fetchDevices()); }
        catch (err) { setError(err.message); }
        finally { setLoading(false); }
    }, []);

    // Initial load
    useEffect(() => { loadDevices(); }, [loadDevices]);

    // Auto-refresh every 15 s — keeps status/last-ping in sync without a page reload
    useEffect(() => {
        const timer = setInterval(loadDevices, 15_000);
        return () => clearInterval(timer);
    }, [loadDevices]);

    async function handleRefresh() {
        setRefreshing(true);
        try { await loadDevices(); }
        finally { setRefreshing(false); }
    }

    // ── Filtering & sorting ───────────────────────────────────────────────────

    const visibleDevices = useMemo(() => {
        let list = [...devices];

        if (search.trim()) {
            const query = search.toLowerCase();
            list = list.filter(d =>
                d.name?.toLowerCase().includes(query) || String(d.id).includes(query)
            );
        }

        if (statusFilter !== 'any') {
            list = list.filter(d => d.status === statusFilter);
        }

        list.sort((a, b) => {
            if (sortOrder === 'id-desc')   return b.id - a.id;
            if (sortOrder === 'id-asc')    return a.id - b.id;
            if (sortOrder === 'name-asc')  return (a.name || '').localeCompare(b.name || '');
            if (sortOrder === 'name-desc') return (b.name || '').localeCompare(a.name || '');
            return 0;
        });

        return list;
    }, [devices, search, sortOrder, statusFilter]);

    // ── Modal handlers ────────────────────────────────────────────────────────

    async function handleAdd(name) {
        await createDevice(name);
        setBanner(true);
        setModal(null);
        loadDevices();
    }

    async function handleRename(name) {
        await renameDevice(activeModal.device.id, name);
        setModal(null);
        loadDevices();
    }

    async function handleDelete() {
        await deleteDevice(activeModal.device.id);
        setModal(null);
        loadDevices();
    }

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="container py-4">

            {/* Page header */}
            <div className="d-flex align-items-center justify-content-between mb-3">
                <h5 className="fw-bold mb-0">My Devices</h5>
                <div className="d-flex gap-2">
                    <button
                        className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
                        onClick={handleRefresh}
                        disabled={isRefreshing}
                        title="Refresh device list"
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
                        className="btn btn-primary btn-sm d-flex align-items-center gap-1"
                        onClick={() => setModal({ mode: 'add' })}
                    >
                        <Icon path={mdiPlus} size={0.75} />
                        Add Device
                    </button>
                </div>
            </div>

            {error && <div className="alert alert-danger py-2 small">{error}</div>}

            {showCreatedBanner && <CodeBanner onDismiss={() => setBanner(false)} />}

            {/* Search & sort toolbar */}
            {devices.length > 0 && (
                <div className="d-flex gap-2 mb-3 flex-wrap">
                    <div className="input-group input-group-sm" style={{ maxWidth: 260 }}>
                        <span className="input-group-text bg-white">
                            <Icon path={mdiMagnify} size={0.7} />
                        </span>
                        <input
                            type="text"
                            className="form-control"
                            placeholder="Search by name or ID…"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                    </div>

                    <div className="input-group input-group-sm" style={{ maxWidth: 180 }}>
                        <span className="input-group-text bg-white">
                            <Icon path={mdiSort} size={0.7} />
                        </span>
                        <select className="form-select" value={sortOrder} onChange={e => setSortOrder(e.target.value)}>
                            <option value="id-desc">Newest first</option>
                            <option value="id-asc">Oldest first</option>
                            <option value="name-asc">Name A → Z</option>
                            <option value="name-desc">Name Z → A</option>
                        </select>
                    </div>

                    <select
                        className="form-select form-select-sm"
                        style={{ maxWidth: 140 }}
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value)}
                    >
                        <option value="any">Any status</option>
                        <option value="online">Online</option>
                        <option value="warning">Warning</option>
                        <option value="offline">Offline</option>
                        <option value="pending">Pending</option>
                    </select>
                </div>
            )}

            {/* Device grid */}
            {loading ? (
                <div className="text-center py-5 text-muted">Loading…</div>
            ) : devices.length === 0 ? (
                <div className="empty-state">
                    <Icon path={mdiDevices} size={3} color="#cbd5e1" />
                    <h6 className="mt-3 fw-semibold">No devices yet</h6>
                    <p className="small">Add your first device to start monitoring SOS alerts.</p>
                    <button className="btn btn-primary btn-sm" onClick={() => setModal({ mode: 'add' })}>
                        <Icon path={mdiPlus} size={0.75} className="me-1" />
                        Add Device
                    </button>
                </div>
            ) : visibleDevices.length === 0 ? (
                <div className="empty-state">
                    <p className="small">No devices match "<strong>{search}</strong>"</p>
                </div>
            ) : (
                <div className="row g-3">
                    {visibleDevices.map(device => (
                        <div className="col-md-6 col-lg-4" key={device.id}>
                            <div className="card device-card h-100">
                                <div className="card-body">
                                    <div className="d-flex justify-content-between align-items-start mb-1">
                                        <div>
                                            <h6 className="fw-semibold mb-0">{device.name}</h6>
                                            <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                                                ID #{device.id}
                                            </span>
                                        </div>
                                        <StatusBadge status={device.status} />
                                    </div>

                                    {device.warning && (
                                        <div className="alert alert-warning py-1 px-2 small mb-2 mt-2">
                                            <Icon path={mdiAlertOutline} size={0.6} className="me-1" />
                                            {device.warning}
                                        </div>
                                    )}

                                    <p className="text-muted small mb-0 mt-2">
                                        Last ping: {formatTime(device.last_seen_at)}
                                    </p>

                                    {device.sos_count > 0 && (
                                        <p className="small mb-0 mt-1">
                                            <Icon path={mdiAlertCircleOutline} size={0.6} color="#ef4444" className="me-1" />
                                            <span className="text-muted">SOS signals: </span>
                                            <span className="text-danger fw-medium">{device.sos_count}</span>
                                        </p>
                                    )}
                                </div>

                                <div className="card-footer bg-transparent border-top-0 d-flex gap-2 pt-0 pb-3 px-3 flex-wrap">
                                    <button
                                        className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
                                        onClick={() => setModal({ mode: 'rename', device })}
                                    >
                                        <Icon path={mdiPencilOutline} size={0.65} />
                                        Rename
                                    </button>

                                    {device.registration_code && (
                                        <button
                                            className="btn btn-outline-primary btn-sm"
                                            onClick={() => setModal({ mode: 'code', device })}
                                        >
                                            Show registration code
                                        </button>
                                    )}

                                    {device.sos_count > 0 && (
                                        <button
                                            className="btn btn-outline-danger btn-sm d-flex align-items-center gap-1"
                                            onClick={() => navigate(`/alerts?device=${device.id}`)}
                                        >
                                            <Icon path={mdiAlertCircleOutline} size={0.65} />
                                            View alerts
                                        </button>
                                    )}

                                    <button
                                        className="btn btn-outline-danger btn-sm d-flex align-items-center gap-1 ms-auto"
                                        onClick={() => setModal({ mode: 'delete', device })}
                                    >
                                        <Icon path={mdiTrashCanOutline} size={0.65} />
                                        Delete
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {activeModal && (
                <DeviceModal
                    mode={activeModal.mode}
                    device={activeModal.device}
                    onSave={activeModal.mode === 'add' ? handleAdd : handleRename}
                    onDelete={handleDelete}
                    onClose={() => setModal(null)}
                />
            )}
        </div>
    );
}
