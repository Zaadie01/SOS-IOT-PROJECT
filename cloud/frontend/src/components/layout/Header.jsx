import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function Header() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    function handleLogout() {
        logout();
        navigate('/login', { replace: true });
    }

    return (
        <header className="app-header">
            <h1>SOS IoT Dashboard</h1>
            <nav className="app-nav">
                <NavLink
                    to="/dashboard"
                    className={({ isActive }) => `nav-tab${isActive ? ' nav-tab-active' : ''}`}
                >
                    Dashboard
                </NavLink>
                <NavLink
                    to="/devices"
                    className={({ isActive }) => `nav-tab${isActive ? ' nav-tab-active' : ''}`}
                >
                    Devices
                </NavLink>
                <NavLink
                    to="/gateways"
                    className={({ isActive }) => `nav-tab${isActive ? ' nav-tab-active' : ''}`}
                >
                    Gateways
                </NavLink>
            </nav>
            <div className="header-user">
                {user && <span className="user-email">{user.email}</span>}
                <button className="logout-btn" onClick={handleLogout}>Sign out</button>
            </div>
        </header>
    );
}
