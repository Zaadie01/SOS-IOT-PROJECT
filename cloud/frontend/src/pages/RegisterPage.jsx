import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '@mdi/react';
import { mdiAccountPlusOutline } from '@mdi/js';
import { register as apiRegister } from '../services/api';
import { useAuth } from '../context/AuthContext';

function GoogleLogo() {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
            <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
        </svg>
    );
}

export default function RegisterPage() {
    const { login, token } = useAuth();
    const navigate = useNavigate();

    const [name, setName]             = useState('');
    const [email, setEmail]           = useState('');
    const [password, setPassword]     = useState('');
    const [confirm, setConfirm]       = useState('');
    const [error, setError]           = useState('');
    const [loading, setLoading]       = useState(false);

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
            const { token: t, user } = await apiRegister(email, password, name);
            login(t, user);
            navigate('/devices', { replace: true });
        } catch (err) {
            setError(err.message || 'Registration failed');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="auth-wrapper">
            <div className="auth-card">
                <div className="text-center mb-4">
                    <Icon path={mdiAccountPlusOutline} size={1.8} color="#0d6efd" />
                    <h4 className="fw-bold mt-2 mb-1">Create account</h4>
                    <p className="text-muted small">Start monitoring your IoT devices</p>
                </div>

                <div className="card border-0 shadow-sm p-4">
                    {error && (
                        <div className="alert alert-danger py-2 small">{error}</div>
                    )}

                    <form onSubmit={handleSubmit}>
                        <div className="mb-3">
                            <label className="form-label small fw-medium">Name <span className="text-muted">(optional)</span></label>
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
                                className={`form-control ${confirm && confirm !== password ? 'is-invalid' : ''}`}
                                value={confirm}
                                onChange={e => setConfirm(e.target.value)}
                                required
                                maxLength={128}
                                autoComplete="new-password"
                                placeholder="Repeat password"
                            />
                            {confirm && confirm !== password && (
                                <div className="invalid-feedback">Passwords do not match</div>
                            )}
                        </div>

                        <button type="submit" className="btn btn-primary w-100" disabled={loading || (confirm && confirm !== password)}>
                            {loading ? 'Creating account…' : 'Create account'}
                        </button>
                    </form>

                    <div className="or-divider my-3">or</div>

                    <a href="/api/auth/google" className="btn btn-google w-100 d-flex align-items-center justify-content-center gap-2">
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
