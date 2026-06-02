import Icon from '@mdi/react';
import {
    mdiPencilOutline, mdiTrashCanOutline, mdiAlertOutline,
    mdiAlertCircleOutline, mdiAccountPlus, mdiEyeOffOutline,
} from '@mdi/js';
import StatusBadge from '../common/StatusBadge';
import { formatTime } from '../../utils/time';

export default function DeviceCard({
    device,
    onRename,
    onShare,
    onShowCode,
    onDelete,
    onViewAlerts,
    onStopWatching,
}) {
    return (
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

                {/* Owner label */}
                <div className="mb-1">
                    {device.is_owner ? (
                        <span className="badge bg-primary bg-opacity-10 text-primary" style={{ fontSize: '0.7rem' }}>
                            You
                        </span>
                    ) : (
                        <span className="badge bg-secondary bg-opacity-10 text-secondary" style={{ fontSize: '0.7rem' }}>
                            {device.owner_name}
                        </span>
                    )}
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
                {device.is_owner && (
                    <>
                        <button
                            className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
                            onClick={onRename}
                        >
                            <Icon path={mdiPencilOutline} size={0.65} />
                            Rename
                        </button>

                        <button
                            className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
                            onClick={onShare}
                            title="Manage access"
                        >
                            <Icon path={mdiAccountPlus} size={0.65} />
                            Share
                        </button>
                    </>
                )}

                {device.is_owner && device.registration_code && (
                    <button
                        className="btn btn-outline-primary btn-sm"
                        onClick={onShowCode}
                    >
                        Show registration code
                    </button>
                )}

                {device.sos_count > 0 && (
                    <button
                        className="btn btn-outline-danger btn-sm d-flex align-items-center gap-1"
                        onClick={onViewAlerts}
                    >
                        <Icon path={mdiAlertCircleOutline} size={0.65} />
                        View alerts
                    </button>
                )}

                {device.is_owner && (
                    <button
                        className="btn btn-outline-danger btn-sm d-flex align-items-center gap-1 ms-auto"
                        onClick={onDelete}
                    >
                        <Icon path={mdiTrashCanOutline} size={0.65} />
                        Delete
                    </button>
                )}

                {!device.is_owner && (
                    <button
                        className="btn btn-outline-danger btn-sm d-flex align-items-center gap-1 ms-auto"
                        onClick={onStopWatching}
                    >
                        <Icon path={mdiEyeOffOutline} size={0.65} />
                        Stop watching
                    </button>
                )}
            </div>
        </div>
    );
}
