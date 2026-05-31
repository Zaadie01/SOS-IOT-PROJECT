const router     = require('express').Router();
const { body }   = require('express-validator');
const { validate }    = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const authCtrl        = require('../controllers/auth.controller');

// ── Validation rules ──────────────────────────────────────────────────────────

const registerRules = [
    body('email')
        .isEmail().withMessage('Invalid email address')
        .isLength({ max: 254 }).withMessage('Email is too long (max 254)'),
    body('password')
        .isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
        .isLength({ max: 128 }).withMessage('Password is too long (max 128)'),
    body('name')
        .optional({ checkFalsy: true })
        .trim()
        .isLength({ max: 50 }).withMessage('Name is too long (max 50)'),
];

const loginRules = [
    body('email').notEmpty().withMessage('Email is required'),
    body('password').notEmpty().withMessage('Password is required'),
];

// ── Routes ────────────────────────────────────────────────────────────────────

router.post('/register', registerRules, validate, authCtrl.register);
router.post('/login',    loginRules,    validate, authCtrl.login);
router.get('/me',        requireAuth,             authCtrl.getCurrentUser);

router.get('/google',                                     authCtrl.startGoogleOAuth);
router.post('/google/prepare-link', requireAuth,          authCtrl.prepareGoogleLink);
router.get('/google/link',                                authCtrl.startGoogleLink);
router.get('/google/callback', authCtrl.googleOAuthCallback, authCtrl.redirectAfterGoogleOAuth);

module.exports = router;
