export default function StatCard({ value, label, variant }) {
    return (
        <div className={`stat-card${variant === 'alert' ? ' alert-stat' : ''}`}>
            <div className="stat-value">{value}</div>
            <div className="stat-label">{label}</div>
        </div>
    );
}
