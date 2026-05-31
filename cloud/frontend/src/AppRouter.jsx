import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';
import { useAuth }         from './context/AuthContext';
import Navbar              from './components/layout/Navbar';
import ProtectedRoute      from './components/auth/ProtectedRoute';
import LandingPage         from './pages/LandingPage';
import LoginPage           from './pages/LoginPage';
import RegisterPage        from './pages/RegisterPage';
import DevicesPage         from './pages/DevicesPage';
import AlertsPage          from './pages/AlertsPage';

/**
 * Contains all application routes and the top-level Navbar.
 * Extracted from App.js so that App.js stays as a minimal provider wrapper.
 */
export default function AppRouter() {
    const { token } = useAuth();

    // Keep /login accessible during an OAuth callback even when already logged in
    const [searchParams] = useSearchParams();
    const hasOAuthToken  = searchParams.has('token');

    return (
        <>
            <Navbar />

            <Routes>
                {/* Public routes — redirect to /devices when already signed in */}
                <Route path="/" element={
                    token ? <Navigate to="/devices" replace /> : <LandingPage />
                } />
                <Route path="/login" element={
                    token && !hasOAuthToken ? <Navigate to="/devices" replace /> : <LoginPage />
                } />
                <Route path="/register" element={
                    token ? <Navigate to="/devices" replace /> : <RegisterPage />
                } />

                {/* Protected routes */}
                <Route path="/devices" element={<ProtectedRoute><DevicesPage /></ProtectedRoute>} />
                <Route path="/alerts"  element={<ProtectedRoute><AlertsPage  /></ProtectedRoute>} />

                {/* Fallback */}
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </>
    );
}
