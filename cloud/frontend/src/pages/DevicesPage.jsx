import { useState, useEffect, useCallback } from 'react';
import { fetchDevices, createDevice, renameDevice, deleteDevice } from '../services/api';

const STATUS_LABELS = {
    pending:  { text: 'Pending',  color: '#888' },
    online:   { text: 'Online',   color: '#22c55e' },
    offline:  { text: 'Offline',  color: '#ef4444' },
    warning:  { text: 'Warning',  color: '#f59e0b' },
};

function StatusBadge({ status }) {
    const s = STATUS_LABELS[status] || STATUS_LABELS.offline;
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            fontWeight: 600, fontSize: '0.85rem', color: s.color,
        }}>
            <span style={{
                width: 8, height: 8, borderRadius: '50%', background: s.color,
            }} />
            {s.text}
        </span>
    );
}

function formatTime(ms) {
    if (!ms) return '—';
    return new Date(ms).toLocaleString();
}

export default function DevicesPage() {
    const [devices, setDevices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [showAdd, setShowAdd] = useState(false);
    const [addName, setAddName] = useState('');
    const [addLoading, setAddLoading] = useState(false);
    const [newCode, setNewCode] = useState(null);

    const [editDevice, setEditDevice] = useState(null);
    const [editName, setEditName] = useState('');
    const [editLoading, setEditLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setDevices(await fetchDevices());
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    async function handleAdd(e) {
        e.preventDefault();
        setAddLoading(true);
        try {
            const result = await createDevice(addName);
            setNewCode(result);
            setAddName('');
            setShowAdd(false);
            load();
        } catch (err) {
            setError(err.message);
        } finally {
            setAddLoading(false);
        }
    }

    async function handleRename(e) {
        e.preventDefault();
        setEditLoading(true);
        try {
            await renameDevice(editDevice.id, editName);
            setEditDevice(null);
            load();
        } catch (err) {
            setError(err.message);
        } finally {
            setEditLoading(false);
        }
    }

    async function handleDelete(device) {
        if (!window.confirm(`Delete "${device.name}"? This also removes all its SOS history.`)) return;
        try {
            await deleteDevice(device.id);
            load();
        } catch (err) {
            setError(err.message);
        }
    }

    return (
        <div className="page-container">
            <div className="page-header">
                <h2>My Devices</h2>
                <button className="btn-primary" onClick={() => setShowAdd(true)}>+ Add Device</button>
            </div>

            {error && <p className="error-msg">{error}</p>}

            {newCode && (
                <div className="code-banner">
                    <strong>Device "{newCode.name}" created!</strong>
                    <p>Enter this code on your device firmware to register it:</p>
                    <code className="reg-code">{newCode.registration_code}</code>
                    <p className="code-expiry">Expires: {formatTime(newCode.expires_at)} — one-time use</p>
                    <button className="btn-secondary" onClick={() => setNewCode(null)}>Dismiss</button>
                </div>
            )}

            {loading ? (
                <p>Loading…</p>
            ) : devices.length === 0 ? (
                <div className="empty-state">
                    <p>No devices yet. Click "+ Add Device" to create one.</p>
                </div>
            ) : (
                <table className="devices-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Status</th>
                            <th>Last seen</th>
                            <th>Warning</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {devices.map(d => (
                            <tr key={d.id}>
                                <td>{d.name || '—'}</td>
                                <td><StatusBadge status={d.status} /></td>
                                <td>{formatTime(d.last_seen_at)}</td>
                                <td>{d.warning || '—'}</td>
                                <td className="actions-cell">
                                    <button className="btn-sm" onClick={() => { setEditDevice(d); setEditName(d.name || ''); }}>
                                        Rename
                                    </button>
                                    <button className="btn-sm btn-danger" onClick={() => handleDelete(d)}>
                                        Delete
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            {showAdd && (
                <div className="modal-overlay">
                    <div className="modal">
                        <h3>Add Device</h3>
                        <form onSubmit={handleAdd}>
                            <label className="login-label">
                                Device name
                                <input
                                    className="login-input"
                                    type="text"
                                    value={addName}
                                    onChange={e => setAddName(e.target.value)}
                                    required
                                    autoFocus
                                    placeholder="e.g. Office SOS Button"
                                />
                            </label>
                            <div className="modal-actions">
                                <button type="button" className="btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
                                <button type="submit" className="btn-primary" disabled={addLoading}>
                                    {addLoading ? 'Creating…' : 'Create'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {editDevice && (
                <div className="modal-overlay">
                    <div className="modal">
                        <h3>Rename Device</h3>
                        <form onSubmit={handleRename}>
                            <label className="login-label">
                                New name
                                <input
                                    className="login-input"
                                    type="text"
                                    value={editName}
                                    onChange={e => setEditName(e.target.value)}
                                    required
                                    autoFocus
                                />
                            </label>
                            <div className="modal-actions">
                                <button type="button" className="btn-secondary" onClick={() => setEditDevice(null)}>Cancel</button>
                                <button type="submit" className="btn-primary" disabled={editLoading}>
                                    {editLoading ? 'Saving…' : 'Save'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
