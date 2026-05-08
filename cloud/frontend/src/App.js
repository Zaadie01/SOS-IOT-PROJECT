import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { useAlerts } from './hooks/useAlerts';
import Header from './components/layout/Header';
import ProtectedRoute from './components/auth/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import GatewaysPage from './pages/GatewaysPage';
import './App.css';

function AppRoutes() {
    const { token } = useAuth();
    const alerts = useAlerts(token);

    return (
        <div className="app">
            {token && <Header />}
            <main>
                <Routes>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/" element={<Navigate to="/dashboard" replace />} />
                    <Route
                        path="/dashboard"
                        element={
                            <ProtectedRoute>
                                <DashboardPage alerts={alerts} />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/gateways"
                        element={
                            <ProtectedRoute>
                                <GatewaysPage />
                            </ProtectedRoute>
                        }
                    />
                </Routes>
            </main>
        </div>
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
