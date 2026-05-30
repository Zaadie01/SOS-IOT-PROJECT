const passport = require('passport');

function requireAuth(req, res, next) {
    passport.authenticate('jwt', { session: false }, (err, user) => {
        if (err)   return next(err);
        if (!user) return res.status(401).json({ error: 'Invalid or expired token' });
        req.user = user;
        next();
    })(req, res, next);
}

module.exports = { requireAuth };
