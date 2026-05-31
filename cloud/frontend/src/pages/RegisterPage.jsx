import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '@mdi/react';
import { mdiAccountPlusOutline } from '@mdi/js';
import { register as apiRegister } from '../api';
import { useAuth } from '../context/AuthContext';
import GoogleLogo from '../components/common/GoogleLogo';

export default function RegisterPage() {
    const { login, token } = useAuth();
    const navigate         = useNavigate();

    const [name, setName]         = useState('');
    const [email, setEmail]       = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm]   = useState('');
    const [error, setError]       = useState('');
    const [loading, setLoading]   = useState(false);

    useEffect(() => {
        if (token) navigate('/devices', { replace: true });
    }, [token, navigate]);

    async function handleSubmit(e) {
        e.preventDefault();
        if (password !== confirm) {
            setError('Passwords do not match');
            return;
        }
        setError('');
        setLoading(true);
        try {
            const { token: newToken, user } = await apiRegister(email, password, name);
            login(newToken, user);
            navigate('/devices', { replace: true });
        } catch (err) {
            setError(err.message || 'Registration failed');
        } finally {
            setLoading(false);
        }
    }

    const passwordsMatch = !confirm || password === confirm;

    return (
        <div className="auth-wrapper">
            <div className="auth-card">
                <div className="text-center mb-4">
                    <Icon path={mdiAccountPlusOutline} size={1.8} color="#0d6efd" />
                    <h4 className="fw-bold mt-2 mb-1">Create account</h4>
                    <p className="text-muted small">Start monitoring your IoT devices</p>
                </div>

                <div className="card border-0 shadow-sm p-4">
                    {error && <div className="alert alert-danger py-2 small">{error}</div>}

                    <form onSubmit={handleSubmit}>
                        <div className="mb-3">
                            <label className="form-label small fw-medium">
                                Name <span className="text-muted">(optional)</span>
                            </label>
                            <input
                                type="text"
                                className="form-control"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                autoFocus
                                autoComplete="name"
                                maxLength={50}
                                placeholder="Your name"
                            />
                        </div>

                        <div className="mb-3">
                            <label className="form-label small fw-medium">Email</label>
                            <input
                                type="email"
                                className="form-control"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                required
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
                                minLength={6}
                                maxLength={128}
                                autoComplete="new-password"
                                placeholder="At least 6 characters"
                            />
                        </div>

                        <div className="mb-4">
                            <label className="form-label small fw-medium">Confirm password</label>
                            <input
                                type="password"
                                className={`form-control ${!passwordsMatch ? 'is-invalid' : ''}`}
                                value={confirm}
                                onChange={e => setConfirm(e.target.value)}
                                required
                                maxLength={128}
                                autoComplete="new-password"
                                placeholder="Repeat password"
                            />
                            {!passwordsMatch && (
                                <div className="invalid-feedback">Passwords do not match</div>
                            )}
                        </div>

                        <button
                            type="submit"
                            className="btn btn-primary w-100"
                            disabled={loading || !passwordsMatch}
                        >
                            {loading ? 'Creating account…' : 'Create account'}
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
                        Already have an account?{' '}
                        <Link to="/login" className="text-decoration-none fw-medium">Sign in</Link>
                    </p>
                </div>
            </div>
        </div>
    );
}
