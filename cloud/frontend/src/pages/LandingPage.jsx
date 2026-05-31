import { Link } from 'react-router-dom';
import Icon from '@mdi/react';
import { mdiAccessPointNetwork } from '@mdi/js';

export default function LandingPage() {
    return (
        <div className="container py-5 text-center" style={{ maxWidth: 480 }}>
            <Icon path={mdiAccessPointNetwork} size={3.5} color="#ef4444" />
            <h2 className="fw-bold mt-3 mb-2">SOS IoT Dashboard</h2>
            <p className="text-muted">
                Monitor emergency button presses from IoT devices in real time.
                Register your device and get instant alerts — from anywhere.
            </p>
            <div className="mt-4">
                <Link to="/register" className="btn btn-primary">Get started</Link>
            </div>
        </div>
    );
}
