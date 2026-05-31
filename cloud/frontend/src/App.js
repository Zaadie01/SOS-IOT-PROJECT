import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Navbar from './components/layout/Navbar';
import ProtectedRoute from './components/auth/ProtectedRoute';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DevicesPage from './pages/DevicesPage';
import AlertsPage from './pages/AlertsPage';

function AppRoutes() {
    const { token } = useAuth();
    const { search } = useLocation();
    const hasOAuthCallback = new URLSearchParams(search).has('token');

    return (
        <>
            {/* Show Navbar on every page except the landing page */}
            {token && <Navbar />}
            {!token && <Navbar />}

            <Routes>
                {/* Public — redirect to /devices if already logged in */}
                <Route path="/" element={
                    token ? <Navigate to="/devices" replace /> : <LandingPage />
                } />
                <Route path="/login" element={
                    token && !hasOAuthCallback ? <Navigate to="/devices" replace /> : <LoginPage />
                } />
                <Route path="/register" element={
                    token ? <Navigate to="/devices" replace /> : <RegisterPage />
                } />

                {/* Protected */}
                <Route path="/devices" element={
                    <ProtectedRoute><DevicesPage /></ProtectedRoute>
                } />
                <Route path="/alerts" element={
                    <ProtectedRoute><AlertsPage /></ProtectedRoute>
                } />

                {/* Fallback */}
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </>
    );
}

export default function App() {
    return (
        <BrowserRouter>
            <AuthProvider>
                <AppRoutes />
            </AuthProvider>
        </BrowserRouter>
    );
}
