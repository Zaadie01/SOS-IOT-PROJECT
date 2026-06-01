const db = require('../db');

function getNotificationPrefs(req, res) {
    const userId = req.user.id;
    const rows   = db.prepare('SELECT device_id, enabled FROM notification_prefs WHERE user_id=?').all(userId);
    const prefs  = {};
    rows.forEach(r => { prefs[r.device_id] = Boolean(r.enabled); });
    res.json({ prefs });
}

function setNotificationPref(req, res) {
    const userId   = req.user.id;
    const deviceId = Number(req.params.deviceId);
    const enabled  = req.body.enabled ? 1 : 0;

    // Must be owner OR accepted invitee
    const access = db.prepare(`
        SELECT 1 FROM gateways WHERE id=? AND owner_id=?
        UNION ALL
        SELECT 1 FROM device_invitations WHERE device_id=? AND invitee_id=? AND status='accepted'
        LIMIT 1
    `).get(deviceId, userId, deviceId, userId);

    if (!access) return res.status(403).json({ error: 'No access to this device' });

    db.prepare(`
        INSERT INTO notification_prefs (user_id, device_id, enabled) VALUES (?, ?, ?)
        ON CONFLICT(user_id, device_id) DO UPDATE SET enabled=excluded.enabled
    `).run(userId, deviceId, enabled);

    res.json({ ok: true });
}

module.exports = { getNotificationPrefs, setNotificationPref };
