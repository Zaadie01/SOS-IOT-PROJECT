import { useState, useEffect, useCallback } from 'react';
import Icon from '@mdi/react';
import { mdiCheck, mdiClose } from '@mdi/js';
import { getReceivedInvitations, acceptInvitation, declineInvitation } from '../../api';

const STATUS_CLASS = {
    pending:  'bg-warning text-dark',
    accepted: 'bg-success',
    declined: 'bg-secondary',
    revoked:  'bg-danger',
};

export default function InvitationsModal({ onClose, onChanged }) {
    const [invitations, setInvitations] = useState([]);
    const [loading, setLoading]         = useState(true);
    const [busy, setBusy]               = useState(null);

    const load = useCallback(() => {
        setLoading(true);
        getReceivedInvitations()
            .then(setInvitations)
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { load(); }, [load]);

    async function handleAction(id, action) {
        setBusy(id);
        try {
            await action(id);
            await load();
            onChanged();
        } catch (_) {}
        finally { setBusy(null); }
    }

    return (
        <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.4)' }}>
            <div className="modal-dialog modal-dialog-centered modal-dialog-scrollable">
                <div className="modal-content">
                    <div className="modal-header border-0 pb-0">
                        <h6 className="modal-title fw-semibold">Invitations</h6>
                        <button type="button" className="btn-close" onClick={onClose} />
                    </div>
                    <div className="modal-body pt-2">
                        {loading ? (
                            <p className="text-muted small text-center py-3">Loading…</p>
                        ) : invitations.length === 0 ? (
                            <p className="text-muted small text-center py-3">No invitations yet.</p>
                        ) : (
                            <ul className="list-group list-group-flush">
                                {invitations.map(inv => (
                                    <li key={inv.id} className="list-group-item px-0 py-2">
                                        <div className="d-flex align-items-center justify-content-between gap-2">
                                            <div>
                                                <div className="fw-medium small">{inv.device_name}</div>
                                                <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                                                    from {inv.owner_name}
                                                </div>
                                            </div>
                                            <div className="d-flex align-items-center gap-2">
                                                <span className={`badge ${STATUS_CLASS[inv.status] || 'bg-secondary'}`}>
                                                    {inv.status}
                                                </span>
                                                {inv.status === 'pending' && (
                                                    <>
                                                        <button
                                                            className="btn btn-success btn-sm py-0 px-1 d-flex align-items-center"
                                                            title="Accept"
                                                            disabled={busy === inv.id}
                                                            onClick={() => handleAction(inv.id, acceptInvitation)}
                                                        >
                                                            <Icon path={mdiCheck} size={0.65} />
                                                        </button>
                                                        <button
                                                            className="btn btn-outline-secondary btn-sm py-0 px-1 d-flex align-items-center"
                                                            title="Decline"
                                                            disabled={busy === inv.id}
                                                            onClick={() => handleAction(inv.id, declineInvitation)}
                                                        >
                                                            <Icon path={mdiClose} size={0.65} />
                                                        </button>
                                                    </>
                                                )}
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
