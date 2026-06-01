const router   = require('express').Router();
const { requireAuth }   = require('../middleware/auth');
const invCtrl           = require('../controllers/invitations.controller');

router.use(requireAuth);

// Owner — device-scoped
router.post  ('/devices/:id/invitations', invCtrl.createInvitation);
router.get   ('/devices/:id/invitations', invCtrl.listDeviceInvitations);

// Owner — invitation-scoped
router.post  ('/invitations/:id/revoke',  invCtrl.revokeInvitation);
router.delete('/invitations/:id',         invCtrl.deleteInvitation);

// Invitee
router.get   ('/invitations/received',    invCtrl.getReceivedInvitations);
router.post  ('/invitations/:id/accept',  invCtrl.acceptInvitation);
router.post  ('/invitations/:id/decline', invCtrl.declineInvitation);

module.exports = router;
