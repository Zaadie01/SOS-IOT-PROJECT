const router   = require('express').Router();
const { body } = require('express-validator');
const { validate }    = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const devicesCtrl     = require('../controllers/devices.controller');

// ── Validation rules ──────────────────────────────────────────────────────────

const nameRules = [
    body('name')
        .trim()
        .notEmpty().withMessage('name is required')
        .isLength({ max: 50 }).withMessage('Device name is too long (max 50)'),
];

// ── Routes (all require a valid user JWT) ─────────────────────────────────────

router.use(requireAuth);

router.get('/',     devicesCtrl.listDevices);
router.post('/',    nameRules, validate, devicesCtrl.createDevice);
router.patch('/:id', nameRules, validate, devicesCtrl.renameDevice);
router.delete('/:id',                    devicesCtrl.deleteDevice);

module.exports = router;
