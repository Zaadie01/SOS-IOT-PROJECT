import StatCard from './StatCard';

export default function StatsGrid({ alerts }) {
    const uniqueDevices = new Set(alerts.map(a => a.device_id)).size;

    return (
        <div className="stats-grid">
            <StatCard value={alerts.length} label="Total SOS Events" variant="alert" />
            <StatCard value={uniqueDevices} label="Registered Devices" />
        </div>
    );
}
