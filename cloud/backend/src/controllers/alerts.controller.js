const db = require('../db');

const ACCESS_SUBQUERY = `(
    g.owner_id = :uid
    OR g.id IN (
        SELECT device_id FROM device_invitations
        WHERE invitee_id = :uid AND status = 'accepted'
    )
)`;

function listAlerts(req, res) {
    const { device_id } = req.query;
    const uid = req.user.id;

    const rows = device_id
        ? db.prepare(`
            SELECT se.id, se.timestamp, se.synced_at, se.device_db_id,
                   g.name AS device_name,
                   COALESCE(u.display_name, u.email) AS owner_name
            FROM   sos_events se
            JOIN   gateways g ON g.id = se.device_db_id
            JOIN   users    u ON u.id = g.owner_id
            WHERE  ${ACCESS_SUBQUERY} AND g.id = :did
            ORDER  BY se.synced_at DESC
          `).all({ uid, did: device_id })
        : db.prepare(`
            SELECT se.id, se.timestamp, se.synced_at, se.device_db_id,
                   g.name AS device_name,
                   COALESCE(u.display_name, u.email) AS owner_name
            FROM   sos_events se
            JOIN   gateways g ON g.id = se.device_db_id
            JOIN   users    u ON u.id = g.owner_id
            WHERE  ${ACCESS_SUBQUERY}
            ORDER  BY se.synced_at DESC
          `).all({ uid });

    res.json({ alerts: rows });
}

module.exports = { listAlerts };
