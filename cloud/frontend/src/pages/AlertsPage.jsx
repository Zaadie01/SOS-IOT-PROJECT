import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '@mdi/react';
import { mdiAlertCircleOutline, mdiBellOffOutline } from '@mdi/js';
import { useAlerts }          from '../hooks/useAlerts';
import { useAuth }            from '../context/AuthContext';
import { fetchDevices }       from '../api';
import DeviceFilter           from '../components/alerts/DeviceFilter';
import LastSosIndicator       from '../components/alerts/LastSosIndicator';
import { formatTime }         from '../utils/time';

const ITEMS_PER_PAGE = 25;

/**
 * Builds the list of page numbers to show in the pagination bar.
 * Inserts '…' where there are gaps.
 */
function buildPageRange(currentPage, totalPages) {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);

    const candidates = new Set(
        [1, totalPages, currentPage, currentPage - 1, currentPage + 1]
            .filter(p => p >= 1 && p <= totalPages)
    );
    const sorted = [...candidates].sort((a, b) => a - b);

    const result = [];
    for (let i = 0; i < sorted.length; i++) {
        if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push('…');
        result.push(sorted[i]);
    }
    return result;
}

export default function AlertsPage() {
    const { token }  = useAuth();
    const alerts     = useAlerts(token);

    const [devices, setDevices]                = useState([]);
    const [searchParams, setSearchParams]      = useSearchParams();
    const [selectedDeviceId, setSelectedRaw]   = useState(() => {
        const param = searchParams.get('device');
        return param ? Number(param) : null;
    });
    const [currentPage, setCurrentPage]        = useState(1);

    function selectDevice(id) {
        setSelectedRaw(id);
        if (id) setSearchParams({ device: id }, { replace: true });
        else    setSearchParams({},             { replace: true });
    }

    // Load registered devices for the filter dropdown
    useEffect(() => {
        fetchDevices()
            .then(list => {
                const registeredOnly = list.filter(d => d.status !== 'pending');
                setDevices(registeredOnly);
                // Clear the URL filter if the device no longer belongs to the user
                if (selectedDeviceId && !registeredOnly.find(d => d.id === selectedDeviceId)) {
                    selectDevice(null);
                }
            })
            .catch(() => {});
    }, []); // eslint-disable-line

    // Reset to page 1 whenever the filter or the alert list changes
    useEffect(() => { setCurrentPage(1); }, [selectedDeviceId, alerts.length]);

    const filteredAlerts = useMemo(() =>
        selectedDeviceId
            ? alerts.filter(a => a.device_db_id === selectedDeviceId)
            : alerts,
        [alerts, selectedDeviceId]
    );

    const totalPages     = Math.ceil(filteredAlerts.length / ITEMS_PER_PAGE);
    const paginatedAlerts = filteredAlerts.slice(
        (currentPage - 1) * ITEMS_PER_PAGE,
        currentPage * ITEMS_PER_PAGE
    );
    const mostRecentAlert = filteredAlerts[0];

    return (
        <div className="container py-4">

            {/* Header row */}
            <div className="d-flex align-items-center justify-content-between mb-4 flex-wrap gap-3">
                <div className="d-flex align-items-center gap-3 flex-wrap">
                    <h5 className="fw-bold mb-0 d-flex align-items-center gap-2">
                        <Icon path={mdiAlertCircleOutline} size={0.9} color="#ef4444" />
                        SOS History
                        {alerts.length > 0 && (
                            <span className="badge bg-danger">{alerts.length}</span>
                        )}
                    </h5>

                    <LastSosIndicator
                        alert={mostRecentAlert}
                        totalCount={filteredAlerts.length}
                    />
                </div>

                {devices.length > 0 && (
                    <DeviceFilter
                        devices={devices}
                        value={selectedDeviceId}
                        onChange={selectDevice}
                    />
                )}
            </div>

            {/* Empty state */}
            {alerts.length === 0 ? (
                <div className="empty-state">
                    <Icon path={mdiBellOffOutline} size={3} color="#cbd5e1" />
                    <h6 className="mt-3 fw-semibold">No SOS alerts yet</h6>
                    <p className="small">Alerts will appear here when a device sends an SOS.</p>
                </div>
            ) : (
                <div className="card border-0 shadow-sm">
                    <div className="table-responsive">
                        <table className="table table-hover align-middle mb-0">
                            <thead className="table-light">
                                <tr>
                                    <th className="text-muted small fw-medium ps-4">#</th>
                                    <th className="text-muted small fw-medium">Device</th>
                                    <th className="text-muted small fw-medium">Device ID</th>
                                    <th className="text-muted small fw-medium">Time</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paginatedAlerts.map((alert, index) => {
                                    const rowNumber = filteredAlerts.length - ((currentPage - 1) * ITEMS_PER_PAGE + index);
                                    return (
                                        <tr key={alert.id}>
                                            <td className="ps-4 text-muted small">{rowNumber}</td>
                                            <td className="fw-medium">{alert.device_name || '—'}</td>
                                            <td className="text-muted small">
                                                {alert.device_db_id ? `#${alert.device_db_id}` : '—'}
                                            </td>
                                            <td className="text-muted small">{formatTime(alert.timestamp)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {filteredAlerts.length === 0 && (
                        <div className="text-center py-4 text-muted small">
                            No alerts for this device
                        </div>
                    )}

                    {totalPages > 1 && (
                        <div className="d-flex align-items-center justify-content-between px-3 py-2 border-top">
                            <span className="text-muted small">
                                {(currentPage - 1) * ITEMS_PER_PAGE + 1}–
                                {Math.min(currentPage * ITEMS_PER_PAGE, filteredAlerts.length)} of{' '}
                                {filteredAlerts.length}
                            </span>
                            <nav>
                                <ul className="pagination pagination-sm mb-0">
                                    <li className={`page-item ${currentPage === 1 ? 'disabled' : ''}`}>
                                        <button className="page-link" onClick={() => setCurrentPage(1)}>«</button>
                                    </li>
                                    <li className={`page-item ${currentPage === 1 ? 'disabled' : ''}`}>
                                        <button className="page-link" onClick={() => setCurrentPage(p => p - 1)}>‹</button>
                                    </li>
                                    {buildPageRange(currentPage, totalPages).map((page, i) =>
                                        page === '…'
                                            ? <li key={`gap-${i}`} className="page-item disabled"><span className="page-link">…</span></li>
                                            : <li key={page} className={`page-item ${page === currentPage ? 'active' : ''}`}>
                                                <button className="page-link" onClick={() => setCurrentPage(page)}>{page}</button>
                                              </li>
                                    )}
                                    <li className={`page-item ${currentPage === totalPages ? 'disabled' : ''}`}>
                                        <button className="page-link" onClick={() => setCurrentPage(p => p + 1)}>›</button>
                                    </li>
                                    <li className={`page-item ${currentPage === totalPages ? 'disabled' : ''}`}>
                                        <button className="page-link" onClick={() => setCurrentPage(totalPages)}>»</button>
                                    </li>
                                </ul>
                            </nav>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
