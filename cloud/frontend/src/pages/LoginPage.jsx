import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import Icon from '@mdi/react';
import { mdiAccountCircleOutline } from '@mdi/js';
import { login as apiLogin } from '../api';
import { useAuth } from '../context/AuthContext';
import GoogleLogo from '../components/common/GoogleLogo';

export default function LoginPage() {
    const { login, token } = useAuth();
    const navigate         = useNavigate();
    const location         = useLocation();
    const [searchParams]   = useSearchParams();
    const redirectTo       = location.state?.from?.pathname || '/devices';

    const [email, setEmail]       = useState('');
    const [password, setPassword] = useState('');
    const [error, setError]       = useState('');
    const [loading, setLoading]   = useState(false);

    // Handle redirect back from Google OAuth (/login?token=...&user=...)
    useEffect(() => {
        const oauthToken = searchParams.get('token');
        const userString = searchParams.get('user');
        const oauthError = searchParams.get('error');

        if (oauthError) {
            setError('Google sign-in failed. Please try again.');
            return;
        }
        if (oauthToken && userString) {
            try {
                login(oauthToken, JSON.parse(decodeURIComponent(userString)));
                navigate('/devices', { replace: true });
            } catch {
                setError('Google sign-in failed — could not parse user data.');
            }
        }
    }, []); // eslint-disable-line

    // Redirect already-authenticated users (but not during an OAuth callback)
    useEffect(() => {
        if (token && !searchParams.get('token')) {
            navigate('/devices', { replace: true });
        }
    }, [token, navigate, searchParams]);

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const { token: newToken, user } = await apiLogin(email, password);
            login(newToken, user);
            navigate(redirectTo, { replace: true });
        } catch (err) {
            setError(err.message || 'Invalid credentials');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="auth-wrapper">
            <div className="auth-card">
                <div className="text-center mb-4">
                    <Icon path={mdiAccountCircleOutline} size={1.8} color="#0d6efd" />
                    <h4 className="fw-bold mt-2 mb-1">Welcome back</h4>
                    <p className="text-muted small">Sign in to your SOS IoT account</p>
                </div>

                <div className="card border-0 shadow-sm p-4">
                    {error && <div className="alert alert-danger py-2 small">{error}</div>}

                    <form onSubmit={handleSubmit}>
                        <div className="mb-3">
                            <label className="form-label small fw-medium">Email</label>
                            <input
                                type="email"
                                className="form-control"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                required
                                autoFocus
                                autoComplete="email"
                                maxLength={254}
                                placeholder="you@example.com"
                            />
                        </div>

                        <div className="mb-3">
                            <label className="form-label small fw-medium">Password</label>
                            <input
                                type="password"
                                className="form-control"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                required
                                autoComplete="current-password"
                                maxLength={128}
                            />
                        </div>

                        <button type="submit" className="btn btn-primary w-100" disabled={loading}>
                            {loading ? 'Signing in…' : 'Sign in'}
                        </button>
                    </form>

                    <div className="or-divider my-3">or</div>

                    <a
                        href="/api/auth/google"
                        className="btn btn-google w-100 d-flex align-items-center justify-content-center gap-2"
                    >
                        <GoogleLogo />
                        Continue with Google
                    </a>

                    <p className="text-center text-muted small mt-3 mb-0">
                        No account?{' '}
                        <Link to="/register" className="text-decoration-none fw-medium">Create one</Link>
                    </p>
                </div>
            </div>
        </div>
    );
}
