import { useState, useEffect, useCallback } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import Icon from '@mdi/react';
import {
    mdiAlertCircleOutline, mdiDevices, mdiAccount, mdiLogout,
    mdiGoogle, mdiLinkVariant, mdiEmailOutline, mdiCheck, mdiClose,
} from '@mdi/js';
import { useAuth } from '../../context/AuthContext';
import {
    getReceivedInvitations,
    acceptInvitation,
    declineInvitation,
} from '../../api';

// ── Status badge for invitations ──────────────────────────────────────────────

const STATUS_CLASS = {
    pending:  'bg-warning text-dark',
    accepted: 'bg-success',
    declined: 'bg-secondary',
    revoked:  'bg-danger',
};

// ── Invitations inbox modal ───────────────────────────────────────────────────

function InvitationsModal({ onClose, onChanged }) {
    const [invitations, setInvitations] = useState([]);
    const [loading, setLoading]         = useState(true);
    const [busy, setBusy]               = useState(null); // id being acted on

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

// ── Navbar ────────────────────────────────────────────────────────────────────

export default function Navbar() {
    const { user, token, logout } = useAuth();
    const navigate = useNavigate();

    const [pendingCount, setPendingCount]       = useState(0);
    const [showInvitations, setShowInvitations] = useState(false);

    const refreshBadge = useCallback(() => {
        if (!token) return;
        getReceivedInvitations()
            .then(list => setPendingCount(list.filter(i => i.status === 'pending').length))
            .catch(() => {});
    }, [token]);

    useEffect(() => {
        refreshBadge();
        const timer = setInterval(refreshBadge, 30_000);
        return () => clearInterval(timer);
    }, [refreshBadge]);

    function handleLogout() {
        logout();
        navigate('/', { replace: true });
    }

    return (
        <>
        <nav className="navbar navbar-expand-md navbar-light bg-white border-bottom shadow-sm">
            <div className="container">
                <Link className="navbar-brand fw-bold" to={token ? '/devices' : '/'}>
                    <Icon path={mdiAlertCircleOutline} size={0.9} color="#ef4444" className="me-2" />
                    SOS IoT
                </Link>

                <button
                    className="navbar-toggler"
                    type="button"
                    data-bs-toggle="collapse"
                    data-bs-target="#nav-menu"
                >
                    <span className="navbar-toggler-icon" />
                </button>

                <div className="collapse navbar-collapse" id="nav-menu">
                    {token ? (
                        <>
                            <ul className="navbar-nav me-auto">
                                <li className="nav-item">
                                    <NavLink className="nav-link" to="/devices">
                                        <Icon path={mdiDevices} size={0.75} className="me-1" />
                                        Devices
                                    </NavLink>
                                </li>
                                <li className="nav-item">
                                    <NavLink className="nav-link" to="/alerts">
                                        <Icon path={mdiAlertCircleOutline} size={0.75} className="me-1" />
                                        Alerts
                                    </NavLink>
                                </li>
                            </ul>

                            <div className="dropdown">
                                <button
                                    className="btn btn-light btn-sm dropdown-toggle d-flex align-items-center gap-2"
                                    data-bs-toggle="dropdown"
                                >
                                    <Icon path={mdiAccount} size={0.75} />
                                    {user?.display_name || user?.email}
                                    {pendingCount > 0 && (
                                        <span className="badge bg-danger rounded-pill">{pendingCount}</span>
                                    )}
                                </button>
                                <ul className="dropdown-menu dropdown-menu-end">
                                    <li>
                                        <span className="dropdown-item-text text-muted small">
                                            {user?.email}
                                        </span>
                                    </li>
                                    {user?.id && (
                                        <li>
                                            <span className="dropdown-item-text text-muted small">
                                                ID #{user.id}
                                            </span>
                                        </li>
                                    )}
                                    <li><hr className="dropdown-divider" /></li>
                                    <li>
                                        <button
                                            className="dropdown-item d-flex align-items-center gap-2"
                                            onClick={() => setShowInvitations(true)}
                                        >
                                            <Icon path={mdiEmailOutline} size={0.75} />
                                            Invitations
                                            {pendingCount > 0 && (
                                                <span className="badge bg-danger rounded-pill ms-auto">
                                                    {pendingCount}
                                                </span>
                                            )}
                                        </button>
                                    </li>
                                    <li><hr className="dropdown-divider" /></li>
                                    {!user?.google_id && (
                                        <li>
                                            <button
                                                className="dropdown-item d-flex align-items-center gap-2"
                                                onClick={async () => {
                                                    const t = localStorage.getItem('sos_auth_token');
                                                    await fetch('/api/auth/google/prepare-link', {
                                                        method: 'POST',
                                                        headers: { Authorization: `Bearer ${t}` },
                                                    });
                                                    window.location.href = '/api/auth/google/link';
                                                }}
                                            >
                                                <Icon path={mdiGoogle} size={0.75} />
                                                Link Google Account
                                            </button>
                                        </li>
                                    )}
                                    {user?.google_id && (
                                        <li>
                                            <span className="dropdown-item text-success d-flex align-items-center gap-2" style={{ cursor: 'default' }}>
                                                <Icon path={mdiLinkVariant} size={0.75} />
                                                Google connected
                                            </span>
                                        </li>
                                    )}
                                    <li>
                                        <button className="dropdown-item d-flex align-items-center gap-2 text-danger" onClick={handleLogout}>
                                            <Icon path={mdiLogout} size={0.75} />
                                            Sign out
                                        </button>
                                    </li>
                                </ul>
                            </div>
                        </>
                    ) : (
                        <div className="ms-auto d-flex gap-2">
                            <Link to="/login" className="btn btn-outline-secondary btn-sm">Sign in</Link>
                            <Link to="/register" className="btn btn-primary btn-sm">Register</Link>
                        </div>
                    )}
                </div>
            </div>
        </nav>

        {showInvitations && (
            <InvitationsModal
                onClose={() => setShowInvitations(false)}
                onChanged={() => { refreshBadge(); setShowInvitations(false); }}
            />
        )}
        </>
    );
}
