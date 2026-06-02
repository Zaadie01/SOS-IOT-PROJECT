import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '@mdi/react';
import {
    mdiPlus, mdiDevices, mdiMagnify, mdiSort, mdiRefresh,
} from '@mdi/js';
import {
    fetchDevices, createDevice, renameDevice, deleteDevice, removeOwnAccess,
} from '../api';
import DeviceModal  from '../components/devices/DeviceModal';
import CodeBanner   from '../components/devices/CodeBanner';
import ShareModal   from '../components/devices/ShareModal';
import DeviceCard   from '../components/devices/DeviceCard';

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DevicesPage() {
    const navigate = useNavigate();

    const [devices, setDevices]         = useState([]);
    const [loading, setLoading]         = useState(true);
    const [isRefreshing, setRefreshing] = useState(false);
    const [error, setError]             = useState('');
    const [showCreatedBanner, setBanner] = useState(false);
    const [activeModal, setModal]       = useState(null); // { mode, device? }
    const [shareDevice, setShareDevice] = useState(null);
    const [search, setSearch]           = useState('');
    const [sortOrder, setSortOrder]     = useState('id-desc');
    const [statusFilter, setStatusFilter] = useState('any');

    const loadDevices = useCallback(async () => {
        try { setDevices(await fetchDevices()); }
        catch (err) { setError(err.message); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { loadDevices(); }, [loadDevices]);

    useEffect(() => {
        const timer = setInterval(loadDevices, 15_000);
        return () => clearInterval(timer);
    }, [loadDevices]);

    async function handleRefresh() {
        setRefreshing(true);
        try { await loadDevices(); }
        finally { setRefreshing(false); }
    }

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

    async function handleStopWatching() {
        await removeOwnAccess(activeModal.device.id);
        setModal(null);
        loadDevices();
    }

    return (
        <div className="container py-4">

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
                            <DeviceCard
                                device={device}
                                onRename={() => setModal({ mode: 'rename', device })}
                                onShare={() => setShareDevice(device)}
                                onShowCode={() => setModal({ mode: 'code', device })}
                                onDelete={() => setModal({ mode: 'delete', device })}
                                onViewAlerts={() => navigate(`/alerts?device=${device.id}`)}
                                onStopWatching={() => setModal({ mode: 'stopWatching', device })}
                            />
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
                    onStopWatching={handleStopWatching}
                    onClose={() => setModal(null)}
                />
            )}

            {shareDevice && (
                <ShareModal
                    device={shareDevice}
                    onClose={() => { setShareDevice(null); loadDevices(); }}
                />
            )}
        </div>
    );
}
