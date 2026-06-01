const router            = require('express').Router();
const { requireAuth }   = require('../middleware/auth');
const notifCtrl         = require('../controllers/notifications.controller');

router.use(requireAuth);

router.get('/notifications',             notifCtrl.getNotificationPrefs);
router.put('/notifications/:deviceId',   notifCtrl.setNotificationPref);

module.exports = router;
