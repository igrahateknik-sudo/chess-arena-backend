/**
 * Admin Review Dashboard API
 */

const express  = require('express');
const router   = express.Router();
const { requireAdmin } = require('../middleware/adminAuth');
const { query }        = require('../lib/db');
const { logAnticheatAction } = require('../lib/auditLog');
const { checkQueueHealth }   = require('../lib/monitor');

// Semua route require admin
router.use(requireAdmin);

// ── GET /api/admin/stats ───────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const statsQuery = `
      SELECT
        (SELECT COUNT(*) FROM users WHERE flagged = true) as total_flagged,
        (SELECT COUNT(*) FROM appeals WHERE status = 'pending') as pending_appeals,
        (SELECT COUNT(*) FROM collusion_flags WHERE reviewed = false) as unreviewed_collusion,
        (SELECT COUNT(*) FROM multi_account_flags WHERE reviewed = false) as unreviewed_multi_account,
        (SELECT COUNT(*) FROM anticheat_actions WHERE action = 'suspend' AND created_at > NOW() - INTERVAL '7 days') as recent_suspends,
        (SELECT COUNT(*) FROM security_events WHERE created_at > NOW() - INTERVAL '1 day') as security_events_today
    `;
    const resStats = await query(statsQuery);
    const row = resStats.rows[0];

    res.json({
      totalFlagged:           parseInt(row.total_flagged),
      pendingAppeals:         parseInt(row.pending_appeals),
      unreviewedCollusion:    parseInt(row.unreviewed_collusion),
      unreviewedMultiAccount: parseInt(row.unreviewed_multi_account),
      recentSuspends7d:       parseInt(row.recent_suspends),
      securityEventsToday:    parseInt(row.security_events_today),
    });
  } catch (err) {
    console.error('[admin/stats]', err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// ── GET /api/admin/flagged-users ──────────────────────────────────────────
router.get('/flagged-users', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page  || '1'));
    const limit = Math.min(50, parseInt(req.query.limit || '20'));
    const offset = (page - 1) * limit;

    const usersRes = await query(`
      SELECT id, username, email, elo, trust_score, flagged, flagged_reason, flagged_at, created_at
      FROM users
      WHERE flagged = true
      ORDER BY flagged_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    const totalRes = await query('SELECT COUNT(*) FROM users WHERE flagged = true');
    const totalCount = parseInt(totalRes.rows[0].count);

    const userIds = usersRes.rows.map(u => u.id);
    let actionsMap = {};
    if (userIds.length > 0) {
      const actionsRes = await query(`
        SELECT user_id, action, reason, flags, score, created_at
        FROM anticheat_actions
        WHERE user_id = ANY($1)
        ORDER BY created_at DESC
      `, [userIds]);

      for (const a of actionsRes.rows) {
        if (!actionsMap[a.user_id]) actionsMap[a.user_id] = [];
        if (actionsMap[a.user_id].length < 5) actionsMap[a.user_id].push(a);
      }
    }

    const users = usersRes.rows.map(u => ({
      ...u,
      recentActions: actionsMap[u.id] || [],
    }));

    res.json({ users, total: totalCount, page, limit });
  } catch (err) {
    console.error('[admin/flagged-users]', err);
    res.status(500).json({ error: 'Failed to load flagged users' });
  }
});

// ── POST /api/admin/users/:id/review ─────────────────────────────────────
router.post('/users/:id/review', async (req, res) => {
  try {
    const { id }                     = req.params;
    const { action, note, newTrust } = req.body;

    if (!['dismiss', 'confirm_suspend', 'unsuspend', 'set_trust'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    const updates = { updated_at: new Date() };
    let actionLabel = action;

    if (action === 'dismiss') {
      updates.flagged        = false;
      updates.flagged_reason = null;
      updates.flagged_at     = null;
      updates.trust_score    = Math.min(100, (newTrust ?? 80));
    } else if (action === 'confirm_suspend') {
      updates.flagged_reason = `[Admin confirmed ${new Date().toISOString()}] ${note || ''}`.trim();
    } else if (action === 'unsuspend') {
      updates.flagged        = false;
      updates.flagged_reason = null;
      updates.flagged_at     = null;
      updates.trust_score    = Math.min(100, (newTrust ?? 70));
    } else if (action === 'set_trust') {
      if (typeof newTrust !== 'number' || newTrust < 0 || newTrust > 100) {
        return res.status(400).json({ error: 'newTrust must be 0-100' });
      }
      updates.trust_score = newTrust;
    }

    const keys = Object.keys(updates);
    const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    await query(`UPDATE users SET ${setClause} WHERE id = $1`, [id, ...Object.values(updates)]);

    await logAnticheatAction({
      userId:  id,
      gameId:  null,
      action:  `admin_${actionLabel}`,
      reason:  `Admin review by ${req.user.username}: ${note || 'no note'}`,
      flags:   [],
      score:   0,
    });

    res.json({ ok: true, action, userId: id });
  } catch (err) {
    console.error('[admin/users/review]', err);
    res.status(500).json({ error: 'Review failed' });
  }
});

// ── GET /api/admin/anticheat-actions ─────────────────────────────────────
router.get('/anticheat-actions', async (req, res) => {
  try {
    const limit = Math.min(100, parseInt(req.query.limit || '50'));
    const action = req.query.action;

    let sql = `
      SELECT a.id, a.action, a.reason, a.flags, a.score, a.created_at,
             u.id as user_id, u.username, u.elo, u.trust_score
      FROM anticheat_actions a
      LEFT JOIN users u ON a.user_id = u.id
    `;
    const params = [limit];
    if (action) {
      sql += ' WHERE a.action = $2';
      params.push(action);
    }
    sql += ' ORDER BY a.created_at DESC LIMIT $1';

    const resActions = await query(sql, params);
    const actions = resActions.rows.map(r => ({
      id: r.id, action: r.action, reason: r.reason, flags: r.flags, score: r.score, created_at: r.created_at,
      users: { id: r.user_id, username: r.username, elo: r.elo, trust_score: r.trust_score }
    }));

    res.json({ actions });
  } catch (err) {
    console.error('[admin/anticheat-actions]', err);
    res.status(500).json({ error: 'Failed to load actions' });
  }
});

// ── GET /api/admin/collusion-flags ───────────────────────────────────────
router.get('/collusion-flags', async (req, res) => {
  try {
    const sql = `
      SELECT cf.*, 
             ua.username as user_a_username, ua.elo as user_a_elo,
             ub.username as user_b_username, ub.elo as user_b_elo
      FROM collusion_flags cf
      LEFT JOIN users ua ON cf.user_id_a = ua.id
      LEFT JOIN users ub ON cf.user_id_b = ub.id
      WHERE cf.reviewed = false
      ORDER BY cf.detected_at DESC
      LIMIT 50
    `;
    const resFlags = await query(sql);
    const flags = resFlags.rows.map(r => ({
      ...r,
      userA: { id: r.user_id_a, username: r.user_a_username, elo: r.user_a_elo },
      userB: { id: r.user_id_b, username: r.user_b_username, elo: r.user_b_elo }
    }));

    res.json({ flags });
  } catch (err) {
    console.error('[admin/collusion-flags]', err);
    res.status(500).json({ error: 'Failed to load collusion flags' });
  }
});

// ── POST /api/admin/collusion-flags/:id/review ───────────────────────────
router.post('/collusion-flags/:id/review', async (req, res) => {
  try {
    const { id }         = req.params;
    const { verdict, note } = req.body;

    if (!['confirmed', 'dismissed'].includes(verdict)) {
      return res.status(400).json({ error: 'verdict must be confirmed or dismissed' });
    }

    await query(`
      UPDATE collusion_flags 
      SET reviewed = true, review_note = $2 
      WHERE id = $1
    `, [id, `${verdict}: ${note || ''} [by ${req.user.username}]`]);

    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/collusion-flags/review]', err);
    res.status(500).json({ error: 'Review failed' });
  }
});

// ── GET /api/admin/multi-account-flags ───────────────────────────────────
router.get('/multi-account-flags', async (req, res) => {
  try {
    const sql = `
      SELECT mf.*, 
             ua.username as user_a_username, ua.email as user_a_email,
             ub.username as user_b_username, ub.email as user_b_email
      FROM multi_account_flags mf
      LEFT JOIN users ua ON mf.user_id_a = ua.id
      LEFT JOIN users ub ON mf.user_id_b = ub.id
      WHERE mf.reviewed = false
      ORDER BY mf.detected_at DESC
      LIMIT 50
    `;
    const resFlags = await query(sql);
    const flags = resFlags.rows.map(f => ({
      ...f,
      fingerprint_hash: f.fingerprint_hash?.slice(0, 12) + '…',
      userA: { id: f.user_id_a, username: f.user_a_username, email: f.user_a_email },
      userB: { id: f.user_id_b, username: f.user_b_username, email: f.user_b_email }
    }));

    res.json({ flags });
  } catch (err) {
    console.error('[admin/multi-account-flags]', err);
    res.status(500).json({ error: 'Failed to load multi-account flags' });
  }
});

// ── POST /api/admin/multi-account-flags/:id/review ───────────────────────
router.post('/multi-account-flags/:id/review', async (req, res) => {
  try {
    const { id }            = req.params;
    const { verdict, note } = req.body;

    if (!['confirmed', 'dismissed'].includes(verdict)) {
      return res.status(400).json({ error: 'verdict must be confirmed or dismissed' });
    }

    await query(`
      UPDATE multi_account_flags 
      SET reviewed = true, review_note = $2 
      WHERE id = $1
    `, [id, `${verdict}: ${note || ''} [by ${req.user.username}]`]);

    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/multi-account-flags/review]', err);
    res.status(500).json({ error: 'Review failed' });
  }
});

// ── GET /api/admin/appeals ────────────────────────────────────────────────
router.get('/appeals', async (req, res) => {
  try {
    const status = req.query.status || 'pending';

    let sql = `
      SELECT a.*, u.username, u.email, u.elo, u.trust_score, u.flagged, u.flagged_reason
      FROM appeals a
      JOIN users u ON a.user_id = u.id
    `;
    const params = [];
    if (status !== 'all') {
      sql += ' WHERE a.status = $1';
      params.push(status);
    }
    sql += ' ORDER BY a.created_at DESC LIMIT 100';

    const resAppeals = await query(sql, params);
    const appeals = resAppeals.rows.map(r => ({
      ...r,
      users: { id: r.user_id, username: r.username, email: r.email, elo: r.elo, trust_score: r.trust_score, flagged: r.flagged, flagged_reason: r.flagged_reason }
    }));

    res.json({ appeals });
  } catch (err) {
    console.error('[admin/appeals]', err);
    res.status(500).json({ error: 'Failed to load appeals' });
  }
});

// ── POST /api/admin/appeals/:id/review ───────────────────────────────────
router.post('/appeals/:id/review', async (req, res) => {
  try {
    const { id }              = req.params;
    const { verdict, note, restoreTrust } = req.body;

    if (!['approved', 'rejected'].includes(verdict)) {
      return res.status(400).json({ error: 'verdict must be approved or rejected' });
    }

    const appealRes = await query('SELECT user_id, status FROM appeals WHERE id = $1', [id]);
    if (appealRes.rowCount === 0) return res.status(404).json({ error: 'Appeal not found' });
    const appeal = appealRes.rows[0];
    if (appeal.status !== 'pending') return res.status(409).json({ error: 'Appeal already reviewed' });

    await query(`
      UPDATE appeals
      SET status = $2, admin_note = $3, reviewed_at = NOW(), reviewed_by = $4
      WHERE id = $1
    `, [id, verdict, note || '', req.userId]);

    if (verdict === 'approved') {
      const trustRestore = typeof restoreTrust === 'number'
        ? Math.min(100, Math.max(0, restoreTrust))
        : 75;

      await query(`
        UPDATE users
        SET flagged = false, flagged_reason = null, flagged_at = null, trust_score = $2, updated_at = NOW()
        WHERE id = $1
      `, [appeal.user_id, trustRestore]);
    }

    await logAnticheatAction({
      userId:  appeal.user_id,
      gameId:  null,
      action:  `appeal_${verdict}`,
      reason:  `Admin ${req.user.username}: ${note || 'no note'}`,
      flags:   [],
      score:   0,
    });

    res.json({ ok: true, verdict, userId: appeal.user_id });
  } catch (err) {
    console.error('[admin/appeals/review]', err);
    res.status(500).json({ error: 'Review failed' });
  }
});

// ── GET /api/admin/queue-health ──────────────────────────────────────────
router.get('/queue-health', async (req, res) => {
  try {
    const { report } = await checkQueueHealth();
    const statusCode  = report.healthy ? 200 : 207;
    res.status(statusCode).json(report);
  } catch (err) {
    console.error('[admin/queue-health]', err);
    res.status(500).json({ error: 'Health check failed' });
  }
});

// ── GET /api/admin/security-events ───────────────────────────────────────
router.get('/security-events', async (req, res) => {
  try {
    const limit    = Math.min(200, parseInt(req.query.limit || '50'));
    const eventType = req.query.type;

    let sql = 'SELECT id, event_type, user_id, details, created_at FROM security_events';
    const params = [limit];
    if (eventType) {
      sql += ' WHERE event_type = $2';
      params.push(eventType);
    }
    sql += ' ORDER BY created_at DESC LIMIT $1';

    const resEvents = await query(sql, params);
    res.json({ events: resEvents.rows });
  } catch (err) {
    console.error('[admin/security-events]', err);
    res.status(500).json({ error: 'Failed to load security events' });
  }
});

module.exports = router;
