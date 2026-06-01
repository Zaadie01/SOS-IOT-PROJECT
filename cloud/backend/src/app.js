const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const morgan   = require('morgan');
const session  = require('express-session');
const passport = require('./config/passport');

const authRoutes         = require('./routes/auth.routes');
const deviceRoutes       = require('./routes/devices.routes');
const gatewayRoutes      = require('./routes/gateway.routes');
const alertRoutes        = require('./routes/alerts.routes');
const invitationRoutes   = require('./routes/invitations.routes');
const notificationRoutes = require('./routes/notifications.routes');

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(morgan('combined'));

// express-session is only needed during the ~10 s Google OAuth redirect dance
app.use(session({
    secret:            process.env.SESSION_SECRET || 'dev-secret',
    resave:            false,
    saveUninitialized: false,
    cookie:            { secure: false, maxAge: 15 * 60 * 1000 },
}));

app.use(passport.initialize());
app.use(passport.session());

// ── Routes ────────────────────────────────────────────────────────────────────

app.use('/api/auth',    authRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api',         gatewayRoutes);   // handles /api/gateway/*
app.use('/api/alerts',  alertRoutes);
app.use('/api',         invitationRoutes);  // /api/devices/:id/invitations + /api/invitations/*
app.use('/api',         notificationRoutes); // /api/notifications[/:deviceId]

module.exports = app;
