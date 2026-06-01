import { BrowserRouter }    from 'react-router-dom';
import { AuthProvider }     from './context/AuthContext';
import { AlertsProvider }   from './context/AlertsContext';
import AppRouter            from './AppRouter';

export default function App() {
    return (
        <BrowserRouter>
            <AuthProvider>
                <AlertsProvider>
                    <AppRouter />
                </AlertsProvider>
            </AuthProvider>
        </BrowserRouter>
    );
}
