import StatsGrid from './StatsGrid';
import AlertsTable from './AlertsTable';

export default function Dashboard({ alerts }) {
    return (
        <section className="dashboard">
            <h2>SOS History</h2>
            <StatsGrid alerts={alerts} />
            <h3>Event Log</h3>
            <AlertsTable alerts={alerts} />
        </section>
    );
}
