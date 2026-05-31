import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '@mdi/react';
import {
    mdiPlus, mdiPencilOutline, mdiTrashCanOutline, mdiContentCopy, mdiCheck,
    mdiDevices, mdiCheckCircle, mdiCloseCircle, mdiAlertOutline, mdiClockOutline,
    mdiMagnify, mdiSort, mdiAlertCircleOutline,
} from '@mdi/js';
import { fetchDevices, createDevice, renameDevice, deleteDevice } from '../services/api';

const STATUS_CONFIG = {
    pending: { label: 'Pending', cls: 'badge-pending', icon: mdiClockOutline },
    online:  { label: 'Online',  cls: 'badge-online',  icon: mdiCheckCircle  },
    offline: { label: 'Offline', cls: 'badge-offline', icon: mdiCloseCircle  },
    warning: { label: 'Warning', cls: 'badge-warning', icon: mdiAlertOutline },
};

function StatusBadge({ status }) {
    const cfg     = STATUS_CONFIG[status] || STATUS_CONFIG.offline;
    const tooltip = status === 'pending'
        ? 'Waiting for firmware registration. Use the registration code to connect the gateway.'
        : undefined;
    return (
        <span
            className={`badge ${cfg.cls} d-inline-flex align-items-center gap-1`}
            title={tooltip}
            style={tooltip ? { cursor: 'help' } : undefined}
        >
            <Icon path={cfg.icon} size={0.55} />
            {cfg.label}
        </span>
    );
}

function formatTime(ms) {
    if (!ms) return '—';
    const d = new Date(ms);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const date = d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' });
    return `${time}, ${date}`;
}

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyButton({ text }) {
    const [copied, setCopied] = useState(false);
    function handleCopy() {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }
    return (
        <button className={`btn btn-sm ${copied ? 'btn-success' : 'btn-outline-secondary'}`} onClick={handleCopy}>
            <Icon path={copied ? mdiCheck : mdiContentCopy} size={0.7} className="me-1" />
            {copied ? 'Copied!' : 'Copy'}
        </button>
    );
}

// ── Device Modal (Add / Rename / Delete / Show code) ──────────────────────────
function DeviceModal({ mode, device, onSave, onDelete, onClose }) {
    const [name, setName]    = useState(device?.name || '');
    const [loading, setLoad] = useState(false);
    const [error, setError]  = useState('');

    async function handleSubmit(e) {
        e.preventDefault();
        setLoad(true);
        setError('');
        try { await onSave(name.trim()); }
        catch (err) { setError(err.message); setLoad(false); }
    }

    async function handleDelete() {
        setLoad(true);
        try { await onDelete(); }
        catch (err) { setError(err.message); setLoad(false); }
    }

    if (mode === 'code') {
        return (
            <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.4)' }}>
                <div className="modal-dialog modal-dialog-centered">
                    <div className="modal-content">
                        <div className="modal-header border-0 pb-0">
                            <h6 className="modal-title fw-semibold">Registration Code</h6>
                            <button type="button" className="btn-close" onClick={onClose} />
                        </div>
                        <div className="modal-body">
                            <p className="text-muted small mb-3">
                                Enter this code on your firmware to register <strong>{device.name}</strong>.
                            </p>
                            <div className="d-flex align-items-center gap-2 mb-2">
                                <code className="fs-4 bg-light px-3 py-2 rounded border flex-grow-1 text-center">
                                    {device.registration_code}
                                </code>
                                <CopyButton text={device.registration_code} />
                            </div>
                            <p className="text-muted small mb-0">
                                Expires: {formatTime(device.reg_code_expires_at)} — one-time use
                            </p>
                        </div>
                        <div className="modal-footer border-0 pt-0">
                            <button className="btn btn-light btn-sm" onClick={onClose}>Close</button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (mode === 'delete') {
        return (
            <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.4)' }}>
                <div className="modal-dialog modal-dialog-centered">
                    <div className="modal-content">
                        <div className="modal-header border-0 pb-0">
                            <h6 className="modal-title fw-semibold">Delete Device</h6>
                            <button type="button" className="btn-close" onClick={onClose} />
                        </div>
                        <div className="modal-body">
                            {error && <div className="alert alert-danger py-2 small">{error}</div>}
                            <p className="mb-0">
                                Delete <strong>{device.name}</strong>? All SOS history for this device will be removed.
                            </p>
                        </div>
                        <div className="modal-footer border-0 pt-0">
                            <button className="btn btn-light btn-sm" onClick={onClose}>Cancel</button>
                            <button className="btn btn-danger btn-sm" onClick={handleDelete} disabled={loading}>
                                {loading ? 'Deleting…' : 'Delete'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.4)' }}>
            <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content">
                    <div className="modal-header border-0 pb-0">
                        <h6 className="modal-title fw-semibold">
                            {mode === 'add' ? 'Add Device' : 'Rename Device'}
                        </h6>
                        <button type="button" className="btn-close" onClick={onClose} />
                    </div>
                    <form onSubmit={handleSubmit}>
                        <div className="modal-body">
                            {error && <div className="alert alert-danger py-2 small">{error}</div>}
                            <label className="form-label small fw-medium">Device name</label>
                            <input
                                type="text"
                                className="form-control"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                required
                                autoFocus
                                maxLength={50}
                                placeholder="e.g. Office SOS Button"
                            />
                        </div>
                        <div className="modal-footer border-0 pt-0">
                            <button type="button" className="btn btn-light btn-sm" onClick={onClose}>Cancel</button>
                            <button type="submit" className="btn btn-primary btn-sm" disabled={loading}>
                                {loading ? 'Saving…' : mode === 'add' ? 'Create' : 'Save'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DevicesPage() {
    const navigate              = useNavigate();
    const [devices, setDevices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState('');
    const [showBanner, setBanner] = useState(false);
    const [modal, setModal]     = useState(null);
    const [search, setSearch]         = useState('');
    const [sort, setSort]             = useState('id-desc');
    const [statusFilter, setStatus]   = useState('any');

    const load = useCallback(async () => {
        try { setDevices(await fetchDevices()); }
        catch (err) { setError(err.message); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { load(); }, [load]);

    const displayed = useMemo(() => {
        let list = [...devices];

        if (search.trim()) {
            const q = search.toLowerCase();
            list = list.filter(d =>
                d.name?.toLowerCase().includes(q) || String(d.id).includes(q)
            );
        }

        if (statusFilter !== 'any') {
            list = list.filter(d => d.status === statusFilter);
        }

        list.sort((a, b) => {
            if (sort === 'id-desc')   return b.id - a.id;
            if (sort === 'id-asc')    return a.id - b.id;
            if (sort === 'name-asc')  return (a.name || '').localeCompare(b.name || '');
            if (sort === 'name-desc') return (b.name || '').localeCompare(a.name || '');
            return 0;
        });
        return list;
    }, [devices, search, sort, statusFilter]);

    async function handleAdd(name) {
        await createDevice(name);
        setBanner(true);
        setModal(null);
        load();
    }

    async function handleRename(name) {
        await renameDevice(modal.device.id, name);
        setModal(null);
        load();
    }

    async function handleDelete() {
        await deleteDevice(modal.device.id);
        setModal(null);
        load();
    }

    return (
        <div className="container py-4">
            {/* Header */}
            <div className="d-flex align-items-center justify-content-between mb-3">
                <h5 className="fw-bold mb-0">My Devices</h5>
                <button className="btn btn-primary btn-sm d-flex align-items-center gap-1" onClick={() => setModal({ mode: 'add' })}>
                    <Icon path={mdiPlus} size={0.75} />
                    Add Device
                </button>
            </div>

            {error && <div className="alert alert-danger py-2 small">{error}</div>}

            {showBanner && (
                <div className="alert alert-success d-flex align-items-center justify-content-between mb-3">
                    <span>
                        ✅ <strong>Device created!</strong> Click <strong>Show registration code</strong> on the device card to view the code.
                    </span>
                    <button type="button" className="btn-close ms-3" onClick={() => setBanner(false)} />
                </div>
            )}

            {/* Search & Sort */}
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
                        <select className="form-select" value={sort} onChange={e => setSort(e.target.value)}>
                            <option value="id-desc">Newest first</option>
                            <option value="id-asc">Oldest first</option>
                            <option value="name-asc">Name A → Z</option>
                            <option value="name-desc">Name Z → A</option>
                        </select>
                    </div>

                    <select className="form-select form-select-sm" style={{ maxWidth: 140 }} value={statusFilter} onChange={e => setStatus(e.target.value)}>
                        <option value="any">Any status</option>
                        <option value="online">Online</option>
                        <option value="warning">Warning</option>
                        <option value="offline">Offline</option>
                        <option value="pending">Pending</option>
                    </select>
                </div>
            )}

            {/* Content */}
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
            ) : displayed.length === 0 ? (
                <div className="empty-state">
                    <p className="small">No devices match "<strong>{search}</strong>"</p>
                </div>
            ) : (
                <div className="row g-3">
                    {displayed.map(device => (
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

            {modal && (
                <DeviceModal
                    mode={modal.mode}
                    device={modal.device}
                    onSave={modal.mode === 'add' ? handleAdd : handleRename}
                    onDelete={handleDelete}
                    onClose={() => setModal(null)}
                />
            )}
        </div>
    );
}
