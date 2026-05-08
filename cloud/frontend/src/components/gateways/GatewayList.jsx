import GatewayCard from './GatewayCard';

export default function GatewayList({ gateways, loading }) {
    if (loading) {
        return <p className="no-data">Loading...</p>;
    }
    if (gateways.length === 0) {
        return <p className="no-data">No gateways registered yet.</p>;
    }
    return (
        <div className="gateway-cards">
            {gateways.map(gw => (
                <GatewayCard key={gw.gateway_id} gw={gw} />
            ))}
        </div>
    );
}
