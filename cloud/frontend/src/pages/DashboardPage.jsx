import SOSAlert from '../components/sos/SOSAlert';
import Dashboard from '../components/dashboard/Dashboard';

export default function DashboardPage({ alerts }) {
    return (
        <>
            <SOSAlert alerts={alerts} />
            <Dashboard alerts={alerts} />
        </>
    );
}
