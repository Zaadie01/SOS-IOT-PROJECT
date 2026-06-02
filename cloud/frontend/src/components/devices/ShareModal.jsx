import { useState, useEffect, useCallback } from 'react';
import Icon from '@mdi/react';
import { mdiAccountPlus, mdiTrashCan } from '@mdi/js';
import { listDeviceInvitations, createInvitation, deleteInvitation } from '../../api';

const INV_STATUS_CLASS = {
    pending:  'bg-warning text-dark',
    accepted: 'bg-success',
    declined: 'bg-secondary',
    revoked:  'bg-danger',
};

export default function ShareModal({ device, onClose }) {
    const [invitations, setInvitations] = useState([]);
    const [loadingList, setLoadingList] = useState(true);
    const [userId, setUserId]           = useState('');
    const [email, setEmail]             = useState('');
    const [inviting, setInviting]       = useState(false);
    const [invError, setInvError]       = useState('');
    const [busy, setBusy]               = useState(null);

    const loadList = useCallback(() => {
        setLoadingList(true);
        listDeviceInvitations(device.id)
            .then(setInvitations)
            .catch(() => {})
            .finally(() => setLoadingList(false));
    }, [device.id]);

    useEffect(() => { loadList(); }, [loadList]);

    async function handleInvite(e) {
        e.preventDefault();
        setInviting(true);
        setInvError('');
        try {
            const payload = userId.trim()
                ? { user_id: Number(userId.trim()) }
                : { email: email.trim() };
            await createInvitation(device.id, payload);
            setUserId('');
            setEmail('');
            await loadList();
        } catch (err) {
            setInvError(err.message);
        } finally {
            setInviting(false);
        }
    }

    async function handleDelete(id) {
        setBusy(id);
        try { await deleteInvitation(id); await loadList(); }
        catch (_) {}
        finally { setBusy(null); }
    }

    return (
        <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.4)' }}>
            <div className="modal-dialog modal-dialog-centered modal-dialog-scrollable">
                <div className="modal-content">
                    <div className="modal-header border-0 pb-0">
                        <h6 className="modal-title fw-semibold">Manage access — {device.name}</h6>
                        <button type="button" className="btn-close" onClick={onClose} />
                    </div>
                    <div className="modal-body pt-2">

                        {/* Invite form */}
                        <form onSubmit={handleInvite} className="mb-3">
                            <p className="small fw-medium mb-2">Invite by User ID or email</p>
                            {invError && (
                                <div className="alert alert-danger py-1 px-2 small mb-2">{invError}</div>
                            )}
                            <div className="d-flex gap-2 mb-2">
                                <input
                                    type="number"
                                    className="form-control form-control-sm"
                                    placeholder="User ID"
                                    value={userId}
                                    onChange={e => { setUserId(e.target.value); setEmail(''); }}
                                    min="1"
                                />
                                <span className="text-muted small align-self-center">or</span>
                                <input
                                    type="email"
                                    className="form-control form-control-sm"
                                    placeholder="Email"
                                    value={email}
                                    onChange={e => { setEmail(e.target.value); setUserId(''); }}
                                />
                            </div>
                            <button
                                type="submit"
                                className="btn btn-primary btn-sm d-flex align-items-center gap-1"
                                disabled={inviting || (!userId.trim() && !email.trim())}
                            >
                                <Icon path={mdiAccountPlus} size={0.65} />
                                {inviting ? 'Inviting…' : 'Send invitation'}
                            </button>
                        </form>

                        <hr className="my-2" />

                        {/* Existing invitations */}
                        <p className="small fw-medium mb-2">Current invitations</p>
                        {loadingList ? (
                            <p className="text-muted small">Loading…</p>
                        ) : invitations.length === 0 ? (
                            <p className="text-muted small">No invitations yet.</p>
                        ) : (
                            <ul className="list-group list-group-flush">
                                {invitations.map(inv => (
                                    <li key={inv.id} className="list-group-item px-0 py-2">
                                        <div className="d-flex align-items-center justify-content-between gap-2">
                                            <div>
                                                <div className="small fw-medium">{inv.invitee_name}</div>
                                                <div className="text-muted" style={{ fontSize: '0.72rem' }}>{inv.invitee_email}</div>
                                            </div>
                                            <div className="d-flex align-items-center gap-1">
                                                <span className={`badge ${INV_STATUS_CLASS[inv.status] || 'bg-secondary'}`}>
                                                    {inv.status}
                                                </span>
                                                <button
                                                    className="btn btn-outline-danger btn-sm py-0 px-1 d-flex align-items-center"
                                                    title="Delete"
                                                    disabled={busy === inv.id}
                                                    onClick={() => handleDelete(inv.id)}
                                                >
                                                    <Icon path={mdiTrashCan} size={0.6} />
                                                </button>
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                    <div className="modal-footer border-0 pt-0">
                        <button className="btn btn-light btn-sm" onClick={onClose}>Close</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
