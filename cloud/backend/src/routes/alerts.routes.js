const router          = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const alertsCtrl      = require('../controllers/alerts.controller');

router.get('/sos', requireAuth, alertsCtrl.listAlerts);

module.exports = router;
