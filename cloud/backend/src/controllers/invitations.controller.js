const db = require('../db');

// ── Owner side ────────────────────────────────────────────────────────────────

function createInvitation(req, res) {
    const deviceId = Number(req.params.id);
    const ownerId  = req.user.id;

    const device = db.prepare('SELECT id FROM gateways WHERE id = ? AND owner_id = ?').get(deviceId, ownerId);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    let invitee;
    if (req.body.user_id) {
        invitee = db.prepare('SELECT id FROM users WHERE id = ?').get(Number(req.body.user_id));
    } else if (req.body.email) {
        invitee = db.prepare('SELECT id FROM users WHERE email = ?').get(req.body.email);
    } else {
        return res.status(400).json({ error: 'user_id or email required' });
    }

    if (!invitee) return res.status(404).json({ error: 'User not found' });
    if (invitee.id === ownerId) return res.status(400).json({ error: 'Cannot invite yourself' });

    const existing = db.prepare(
        'SELECT id, status FROM device_invitations WHERE device_id = ? AND invitee_id = ?'
    ).get(deviceId, invitee.id);

    if (existing) {
        if (existing.status === 'pending' || existing.status === 'accepted') {
            return res.status(409).json({ error: 'Invitation already active' });
        }
        // declined | revoked → resend
        db.prepare(
            'UPDATE device_invitations SET status=?, created_at=?, responded_at=NULL, inviter_id=? WHERE id=?'
        ).run('pending', Date.now(), ownerId, existing.id);
        return res.status(201).json({ id: existing.id, status: 'pending' });
    }

    const { lastInsertRowid } = db.prepare(`
        INSERT INTO device_invitations (device_id, inviter_id, invitee_id, status, created_at)
        VALUES (?, ?, ?, 'pending', ?)
    `).run(deviceId, ownerId, invitee.id, Date.now());

    res.status(201).json({ id: lastInsertRowid, status: 'pending' });
}

function listDeviceInvitations(req, res) {
    const deviceId = Number(req.params.id);
    const ownerId  = req.user.id;

    const device = db.prepare('SELECT id FROM gateways WHERE id = ? AND owner_id = ?').get(deviceId, ownerId);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const rows = db.prepare(`
        SELECT di.id, di.invitee_id, di.status, di.created_at,
               COALESCE(u.display_name, u.email) AS invitee_name,
               u.email AS invitee_email
        FROM   device_invitations di
        JOIN   users u ON u.id = di.invitee_id
        WHERE  di.device_id = ?
        ORDER  BY di.created_at DESC
    `).all(deviceId);

    res.json({ invitations: rows });
}

function revokeInvitation(req, res) {
    const invId   = Number(req.params.id);
    const ownerId = req.user.id;

    const inv = db.prepare(`
        SELECT di.id, di.status, di.device_id, di.invitee_id
        FROM   device_invitations di
        JOIN   gateways g ON g.id = di.device_id
        WHERE  di.id = ? AND g.owner_id = ?
    `).get(invId, ownerId);

    if (!inv) return res.status(404).json({ error: 'Invitation not found' });
    if (inv.status !== 'pending' && inv.status !== 'accepted') {
        return res.status(409).json({ error: 'Cannot revoke invitation in this state' });
    }

    db.prepare('UPDATE device_invitations SET status=? WHERE id=?').run('revoked', invId);
    db.prepare('DELETE FROM notification_prefs WHERE user_id=? AND device_id=?').run(inv.invitee_id, inv.device_id);

    res.json({ ok: true });
}

function deleteInvitation(req, res) {
    const invId   = Number(req.params.id);
    const ownerId = req.user.id;

    const inv = db.prepare(`
        SELECT di.id, di.invitee_id, di.device_id
        FROM   device_invitations di
        JOIN   gateways g ON g.id = di.device_id
        WHERE  di.id = ? AND g.owner_id = ?
    `).get(invId, ownerId);

    if (!inv) return res.status(404).json({ error: 'Invitation not found' });

    db.prepare('DELETE FROM device_invitations WHERE id=?').run(invId);
    db.prepare('DELETE FROM notification_prefs WHERE user_id=? AND device_id=?').run(inv.invitee_id, inv.device_id);

    res.json({ ok: true });
}

// ── Invitee side ──────────────────────────────────────────────────────────────

function getReceivedInvitations(req, res) {
    const inviteeId = req.user.id;

    const rows = db.prepare(`
        SELECT di.id, di.device_id, di.status, di.created_at,
               g.name AS device_name,
               COALESCE(u.display_name, u.email) AS owner_name
        FROM   device_invitations di
        JOIN   gateways g ON g.id = di.device_id
        JOIN   users    u ON u.id = di.inviter_id
        WHERE  di.invitee_id = ?
        ORDER  BY di.created_at DESC
    `).all(inviteeId);

    res.json({ invitations: rows });
}

function acceptInvitation(req, res) {
    const invId     = Number(req.params.id);
    const inviteeId = req.user.id;

    const inv = db.prepare(
        'SELECT id, status FROM device_invitations WHERE id=? AND invitee_id=?'
    ).get(invId, inviteeId);

    if (!inv) return res.status(404).json({ error: 'Invitation not found' });
    if (inv.status !== 'pending') return res.status(409).json({ error: 'Invitation is not pending' });

    db.prepare('UPDATE device_invitations SET status=?, responded_at=? WHERE id=?').run('accepted', Date.now(), invId);
    res.json({ ok: true });
}

function declineInvitation(req, res) {
    const invId     = Number(req.params.id);
    const inviteeId = req.user.id;

    const inv = db.prepare(
        'SELECT id, status, device_id FROM device_invitations WHERE id=? AND invitee_id=?'
    ).get(invId, inviteeId);

    if (!inv) return res.status(404).json({ error: 'Invitation not found' });
    if (inv.status !== 'pending') return res.status(409).json({ error: 'Invitation is not pending' });

    db.prepare('UPDATE device_invitations SET status=?, responded_at=? WHERE id=?').run('declined', Date.now(), invId);
    db.prepare('DELETE FROM notification_prefs WHERE user_id=? AND device_id=?').run(inviteeId, inv.device_id);

    res.json({ ok: true });
}

module.exports = {
    createInvitation,
    listDeviceInvitations,
    revokeInvitation,
    deleteInvitation,
    getReceivedInvitations,
    acceptInvitation,
    declineInvitation,
};
