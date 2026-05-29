import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { register as apiRegister, fetchInvite } from '../services/api';
import { useAuth } from '../context/AuthContext';

export default function RegisterPage() {
    const { login } = useAuth();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const inviteToken = searchParams.get('invite');

    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [inviteInfo, setInviteInfo] = useState(null);

    useEffect(() => {
        if (!inviteToken) return;
        fetchInvite(inviteToken)
            .then(data => {
                setInviteInfo(data);
                if (data.email) setEmail(data.email);
            })
            .catch(() => setError('Invite link is invalid or expired.'));
    }, [inviteToken]);

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const { token, user } = await apiRegister(email, password, name, inviteToken);
            login(token, user);
            navigate('/devices', { replace: true });
        } catch (err) {
            setError(err.message || 'Registration failed');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="login-page">
            <div className="login-card">
                <h1 className="login-title">Create account</h1>
                <p className="login-subtitle">
                    {inviteInfo ? `Invited by user #${inviteInfo.created_by}` : 'SOS IoT Dashboard'}
                </p>
                {error && <p className="login-error">{error}</p>}
                <form onSubmit={handleSubmit} className="login-form">
                    <label className="login-label">
                        Name (optional)
                        <input
                            className="login-input"
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            autoComplete="name"
                            placeholder="Your name"
                        />
                    </label>
                    <label className="login-label">
                        Email
                        <input
                            className="login-input"
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            required
                            autoFocus
                            autoComplete="email"
                            readOnly={!!inviteInfo?.email}
                        />
                    </label>
                    <label className="login-label">
                        Password
                        <input
                            className="login-input"
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                            minLength={6}
                            autoComplete="new-password"
                            placeholder="At least 6 characters"
                        />
                    </label>
                    <button className="login-btn" type="submit" disabled={loading}>
                        {loading ? 'Creating account…' : 'Create account'}
                    </button>
                </form>
                <p style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.9rem' }}>
                    Already have an account? <Link to="/login">Sign in</Link>
                </p>
            </div>
        </div>
    );
}
