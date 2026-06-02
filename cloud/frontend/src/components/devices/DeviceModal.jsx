import { useState } from 'react';
import Icon from '@mdi/react';
import { mdiContentCopy, mdiCheck } from '@mdi/js';
import { formatTime } from '../../utils/time';

// ── Copy-to-clipboard button ──────────────────────────────────────────────────

function CopyButton({ text }) {
    const [copied, setCopied] = useState(false);

    function handleCopy() {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    return (
        <button
            className={`btn btn-sm ${copied ? 'btn-success' : 'btn-outline-secondary'}`}
            onClick={handleCopy}
        >
            <Icon path={copied ? mdiCheck : mdiContentCopy} size={0.7} className="me-1" />
            {copied ? 'Copied!' : 'Copy'}
        </button>
    );
}

// ── Shared modal shell ────────────────────────────────────────────────────────

function ModalShell({ title, onClose, children }) {
    return (
        <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.4)' }}>
            <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content">
                    <div className="modal-header border-0 pb-0">
                        <h6 className="modal-title fw-semibold">{title}</h6>
                        <button type="button" className="btn-close" onClick={onClose} />
                    </div>
                    {children}
                </div>
            </div>
        </div>
    );
}

// ── Mode: show registration code ──────────────────────────────────────────────

function RegistrationCodeModal({ device, onClose }) {
    return (
        <ModalShell title="Registration Code" onClose={onClose}>
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
        </ModalShell>
    );
}

// ── Mode: confirm delete ──────────────────────────────────────────────────────

function DeleteConfirmModal({ device, onDelete, onClose }) {
    const [loading, setLoading] = useState(false);
    const [error, setError]     = useState('');

    async function handleDelete() {
        setLoading(true);
        try { await onDelete(); }
        catch (err) { setError(err.message); setLoading(false); }
    }

    return (
        <ModalShell title="Delete Device" onClose={onClose}>
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
        </ModalShell>
    );
}

// ── Mode: add or rename ───────────────────────────────────────────────────────

function NameFormModal({ mode, device, onSave, onClose }) {
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

    const title = mode === 'add' ? 'Add Device' : 'Rename Device';

    return (
        <ModalShell title={title} onClose={onClose}>
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
        </ModalShell>
    );
}

// ── Mode: confirm stop watching ───────────────────────────────────────────────

function StopWatchingConfirmModal({ device, onStopWatching, onClose }) {
    const [loading, setLoading] = useState(false);
    const [error, setError]     = useState('');

    async function handleConfirm() {
        setLoading(true);
        try { await onStopWatching(); }
        catch (err) { setError(err.message); setLoading(false); }
    }

    return (
        <ModalShell title="Stop watching" onClose={onClose}>
            <div className="modal-body">
                {error && <div className="alert alert-danger py-2 small">{error}</div>}
                <p className="mb-0">
                    Stop watching <strong>{device.name}</strong>? You will stop receiving its alerts.
                </p>
            </div>
            <div className="modal-footer border-0 pt-0">
                <button className="btn btn-light btn-sm" onClick={onClose}>Cancel</button>
                <button className="btn btn-danger btn-sm" onClick={handleConfirm} disabled={loading}>
                    {loading ? 'Stopping…' : 'Stop watching'}
                </button>
            </div>
        </ModalShell>
    );
}

// ── Public component — picks the right modal variant by mode ──────────────────

export default function DeviceModal({ mode, device, onSave, onDelete, onStopWatching, onClose }) {
    if (mode === 'code')          return <RegistrationCodeModal device={device} onClose={onClose} />;
    if (mode === 'delete')        return <DeleteConfirmModal device={device} onDelete={onDelete} onClose={onClose} />;
    if (mode === 'stopWatching')  return <StopWatchingConfirmModal device={device} onStopWatching={onStopWatching} onClose={onClose} />;
    return <NameFormModal mode={mode} device={device} onSave={onSave} onClose={onClose} />;
}
