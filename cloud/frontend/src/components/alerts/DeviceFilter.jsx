import { useState, useEffect, useRef } from 'react';
import Icon from '@mdi/react';
import { mdiChevronDown, mdiClose } from '@mdi/js';

/**
 * Searchable dropdown that lets the user pick one device (or "All devices").
 * Closes when the user clicks outside.
 */
export default function DeviceFilter({ devices, value, onChange }) {
    const [isOpen, setIsOpen]   = useState(false);
    const [search, setSearch]   = useState('');
    const containerRef          = useRef(null);

    useEffect(() => {
        function handleOutsideClick(e) {
            if (containerRef.current && !containerRef.current.contains(e.target)) {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleOutsideClick);
        return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, []);

    const filteredDevices = devices.filter(device => {
        if (!search) return true;
        const query = search.toLowerCase();
        return device.name?.toLowerCase().includes(query) || String(device.id).includes(query);
    });

    const selectedDevice = devices.find(d => d.id === value);
    const dropdownLabel  = value
        ? (selectedDevice ? `${selectedDevice.name} (#${selectedDevice.id})` : `#${value}…`)
        : 'All devices';

    function selectDevice(id) {
        onChange(id);
        setIsOpen(false);
        setSearch('');
    }

    return (
        <div ref={containerRef} className="position-relative" style={{ minWidth: 230 }}>
            <div
                className={`form-control form-control-sm d-flex align-items-center justify-content-between gap-2 ${
                    value ? 'border-primary text-primary' : 'text-secondary'
                }`}
                style={{ cursor: 'pointer', userSelect: 'none', borderWidth: value ? 2 : 1 }}
                onClick={() => setIsOpen(open => !open)}
            >
                <span className="text-truncate">{dropdownLabel}</span>
                <div className="d-flex align-items-center gap-1 flex-shrink-0">
                    {value && (
                        <span
                            onClick={e => { e.stopPropagation(); selectDevice(null); }}
                            style={{ cursor: 'pointer', lineHeight: 1 }}
                        >
                            <Icon path={mdiClose} size={0.6} color="#94a3b8" />
                        </span>
                    )}
                    <Icon path={mdiChevronDown} size={0.7} color="#94a3b8" />
                </div>
            </div>

            {isOpen && (
                <div
                    className="position-absolute w-100 bg-white border rounded shadow mt-1"
                    style={{ zIndex: 1000, maxHeight: 280, overflowY: 'auto' }}
                >
                    <div className="p-2 border-bottom sticky-top bg-white">
                        <input
                            type="text"
                            className="form-control form-control-sm"
                            placeholder="Search by name or ID…"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            autoFocus
                            onClick={e => e.stopPropagation()}
                        />
                    </div>

                    <div
                        className={`px-3 py-2 small ${!value ? 'fw-semibold bg-light' : 'text-muted'}`}
                        style={{ cursor: 'pointer' }}
                        onClick={() => selectDevice(null)}
                    >
                        All devices
                    </div>

                    {filteredDevices.map(device => (
                        <div
                            key={device.id}
                            className={`px-3 py-2 small d-flex justify-content-between ${
                                value === device.id ? 'fw-semibold bg-light' : ''
                            }`}
                            style={{ cursor: 'pointer' }}
                            onClick={() => selectDevice(device.id)}
                            onMouseEnter={e => { if (value !== device.id) e.currentTarget.style.background = '#f8fafc'; }}
                            onMouseLeave={e => { if (value !== device.id) e.currentTarget.style.background = ''; }}
                        >
                            <span>{device.name}</span>
                            <span className="text-muted ms-2">#{device.id}</span>
                        </div>
                    ))}

                    {filteredDevices.length === 0 && (
                        <div className="px-3 py-2 small text-muted">No devices found</div>
                    )}
                </div>
            )}
        </div>
    );
}
