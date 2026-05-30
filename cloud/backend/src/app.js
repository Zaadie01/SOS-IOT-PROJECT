const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const morgan   = require('morgan');
const session  = require('express-session');
const passport = require('./config/passport');

const authRoutes    = require('./routes/auth');
const deviceRoutes  = require('./routes/devices');
const gatewayRoutes = require('./routes/gateway');
const alertRoutes   = require('./routes/alerts');

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(morgan('combined'));

// Session is only needed for the Google OAuth redirect dance (~10 s)
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
app.use('/api',         gatewayRoutes);  // /api/gateway/*
app.use('/api/alerts',  alertRoutes);

module.exports = app;
