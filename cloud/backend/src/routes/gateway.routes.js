const router   = require('express').Router();
const { body } = require('express-validator');
const { validate }        = require('../middleware/validate');
const { requireGateway }  = require('../middleware/gateway');
const gatewayCtrl         = require('../controllers/gateway.controller');

// ── Validation rules ──────────────────────────────────────────────────────────

const registerRules = [
    body('registration_code')
        .notEmpty().withMessage('registration_code is required')
        .isLength({ min: 8, max: 8 }).withMessage('registration_code must be exactly 8 characters'),
];

const sosDataRules = [
    body('sos_alert')
        .isBoolean().withMessage('sos_alert must be a boolean'),
    body('button_pressed')
        .optional()
        .isInt({ min: 0 }).withMessage('button_pressed must be a non-negative integer'),
    body('timestamp')
        .optional()
        .isInt({ min: 0 }).withMessage('timestamp must be a positive integer'),
];

const warningRules = [
    body('message')
        .optional({ nullable: true })
        .isLength({ max: 200 }).withMessage('Warning message is too long (max 200)'),
];

// ── Routes ────────────────────────────────────────────────────────────────────

// Registration does not need requireGateway — the device has no token yet
router.post('/gateway/register', registerRules,  validate, gatewayCtrl.registerGateway);

// All other device→server routes require a valid gateway token
router.post('/gateway/data',    requireGateway, sosDataRules, validate, gatewayCtrl.handleSosData);
router.post('/gateway/ping',    requireGateway,               gatewayCtrl.handleHeartbeat);
router.post('/gateway/warning', requireGateway, warningRules, validate, gatewayCtrl.handleWarning);

module.exports = router;
