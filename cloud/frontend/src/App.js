import { BrowserRouter } from 'react-router-dom';
import { AuthProvider }  from './context/AuthContext';
import AppRouter         from './AppRouter';

export default function App() {
    return (
        <BrowserRouter>
            <AuthProvider>
                <AppRouter />
            </AuthProvider>
        </BrowserRouter>
    );
}
