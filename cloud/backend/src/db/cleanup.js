const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Deletes device slots whose one-time registration code has expired
 * and whose firmware never connected (token is still NULL).
 */
function deleteExpiredUnactivatedDevices(db) {
    const { changes } = db.prepare(`
        DELETE FROM gateways
        WHERE registration_code   IS NOT NULL
          AND reg_code_expires_at  < ?
          AND token                IS NULL
    `).run(Date.now());

    if (changes > 0) {
        console.log(`[db] Removed ${changes} expired unactivated device(s)`);
    }
}

/**
 * Runs one immediate cleanup, then schedules it to repeat every hour.
 * Must be called AFTER initSchema() so the gateways table exists.
 */
function startCleanupJob(db) {
    deleteExpiredUnactivatedDevices(db);
    setInterval(() => deleteExpiredUnactivatedDevices(db), CLEANUP_INTERVAL_MS);
}

module.exports = { startCleanupJob };
