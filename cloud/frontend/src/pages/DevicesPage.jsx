import { useState, useEffect, useCallback } from 'react';
import {
    fetchDevices, createDevice, renameDevice, deleteDevice,
    revokeDevice, regenDeviceCode,
} from '../services/api';

function CodeBadge({ code, expiresAt }) {
    if (!code) return <span className="badge badge-ok">Registered</span>;
    const expired = expiresAt && Date.now() > expiresAt;
    return (
        <span className={`badge ${expired ? 'badge-warn' : 'badge-code'}`}>
            {expired ? 'Code expired' : `Code: ${code}`}
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

    // Add modal
    const [showAdd, setShowAdd] = useState(false);
    const [addName, setAddName] = useState('');
    const [addLoading, setAddLoading] = useState(false);
    const [newCode, setNewCode] = useState(null); // { id, name, registration_code, expires_at }

    // Edit modal
    const [editDevice, setEditDevice] = useState(null); // { id, name }
    const [editName, setEditName] = useState('');
    const [editLoading, setEditLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await fetchDevices();
            setDevices(data);
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
        if (!window.confirm(`Delete "${device.name || device.gateway_id}"? This also removes all its SOS history.`)) return;
        try {
            await deleteDevice(device.id);
            load();
        } catch (err) {
            setError(err.message);
        }
    }

    async function handleRevoke(device) {
        if (!window.confirm(`Revoke token for "${device.name || device.gateway_id}"? The device will stop sending data.`)) return;
        try {
            await revokeDevice(device.id);
            load();
        } catch (err) {
            setError(err.message);
        }
    }

    async function handleRegenCode(device) {
        if (!window.confirm(`Generate a new registration code for "${device.name || device.gateway_id}"?`)) return;
        try {
            const result = await regenDeviceCode(device.id);
            setNewCode({ ...device, ...result });
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

            {/* New registration code banner */}
            {newCode && (
                <div className="code-banner">
                    <strong>Device "{newCode.name}" created!</strong>
                    <p>Enter this code on your device firmware to register it:</p>
                    <code className="reg-code">{newCode.registration_code}</code>
                    <p className="code-expiry">
                        Expires: {formatTime(newCode.expires_at)} — code is one-time use
                    </p>
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
                            <th>Gateway ID</th>
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
                                <td><code>{d.gateway_id?.startsWith('pending-') ? '(pending)' : (d.gateway_id || '—')}</code></td>
                                <td>
                                    <CodeBadge code={d.registration_code} expiresAt={d.reg_code_expires_at} />
                                </td>
                                <td>{formatTime(d.last_seen_at)}</td>
                                <td>{d.warning || '—'}</td>
                                <td className="actions-cell">
                                    <button className="btn-sm" onClick={() => { setEditDevice(d); setEditName(d.name || ''); }}>
                                        Rename
                                    </button>
                                    {d.is_registered ? (
                                        <button className="btn-sm btn-warn" onClick={() => handleRevoke(d)}>
                                            Revoke
                                        </button>
                                    ) : (
                                        <button className="btn-sm" onClick={() => handleRegenCode(d)}>
                                            New code
                                        </button>
                                    )}
                                    <button className="btn-sm btn-danger" onClick={() => handleDelete(d)}>
                                        Delete
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            {/* Add device modal */}
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
                                <button type="button" className="btn-secondary" onClick={() => setShowAdd(false)}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn-primary" disabled={addLoading}>
                                    {addLoading ? 'Creating…' : 'Create'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Edit device modal */}
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
                                <button type="button" className="btn-secondary" onClick={() => setEditDevice(null)}>
                                    Cancel
                                </button>
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
