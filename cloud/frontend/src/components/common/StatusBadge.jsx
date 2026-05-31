import Icon from '@mdi/react';
import { mdiCheckCircle, mdiCloseCircle, mdiAlertOutline, mdiClockOutline } from '@mdi/js';

const STATUS_CONFIG = {
    pending: {
        label:   'Pending',
        cssClass: 'badge-pending',
        icon:     mdiClockOutline,
        tooltip:  'Waiting for firmware registration. Use the registration code to connect the gateway.',
    },
    online:  { label: 'Online',  cssClass: 'badge-online',  icon: mdiCheckCircle  },
    offline: { label: 'Offline', cssClass: 'badge-offline', icon: mdiCloseCircle  },
    warning: { label: 'Warning', cssClass: 'badge-warning', icon: mdiAlertOutline },
};

export default function StatusBadge({ status }) {
    const config = STATUS_CONFIG[status] || STATUS_CONFIG.offline;

    return (
        <span
            className={`badge ${config.cssClass} d-inline-flex align-items-center gap-1`}
            title={config.tooltip}
            style={config.tooltip ? { cursor: 'help' } : undefined}
        >
            <Icon path={config.icon} size={0.55} />
            {config.label}
        </span>
    );
}
