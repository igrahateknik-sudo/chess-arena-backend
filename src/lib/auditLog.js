/**
 * Audit Trail Logger
 * Setiap move yang diterima server dicatat secara immutable:
 * - ke console (structured JSON, always works)
 * - ke database move_audit_log (non-blocking, fail silently)
 */

const { query } = require('./db');

/**
 * Log satu move yang sudah divalidasi dan diterima server
 */
async function logMove({
  gameId,
  userId,
  moveSeq,       // nomor urut move dalam game (1, 2, 3, ...)
  san,           // notasi standar: e4, Nf3, O-O, dll
  from,          // e2
  to,            // e4
  fenAfter,      // FEN setelah move dieksekusi
  timeTakenMs,   // waktu dari move sebelumnya (ms)
  timeLeft,      // sisa waktu player (ms)
  serverTs,      // Date.now() saat server menerima event
}) {
  const entry = {
    game_id:      gameId,
    user_id:      userId,
    move_seq:     moveSeq,
    san,
    from_sq:      from,
    to_sq:        to,
    fen_after:    fenAfter,
    time_taken_ms: timeTakenMs,
    time_left:    timeLeft,
    server_ts:    serverTs,
  };

  // Selalu log ke console sebagai audit trail primer
  console.log('[AUDIT:MOVE]', JSON.stringify(entry));

  // Persist ke DB (non-blocking)
  const keys = Object.keys(entry);
  const values = Object.values(entry);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const sql = `INSERT INTO move_audit_log (${keys.join(', ')}) VALUES (${placeholders})`;
  
  query(sql, values)
    .catch((e) => console.error('[AUDIT] DB write failed:', e.message));
}

/**
 * Log tindakan anti-cheat (peringatan, flag, suspend)
 */
async function logAnticheatAction({
  userId,
  gameId,
  action,   // 'warn' | 'flag' | 'suspend'
  reason,
  flags,    // array of flag strings
  score,    // suspicion score 0–100
}) {
  const entry = {
    user_id:  userId,
    game_id:  gameId,
    action,
    reason,
    flags:    JSON.stringify(flags),
    score,
  };

  console.log('[AUDIT:ANTICHEAT]', JSON.stringify(entry));

  const keys = Object.keys(entry);
  const values = Object.values(entry);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const sql = `INSERT INTO anticheat_actions (${keys.join(', ')}) VALUES (${placeholders})`;

  query(sql, values)
    .catch((e) => console.error('[AUDIT] Anticheat DB write failed:', e.message));
}

/**
 * Log event keamanan umum (multi-tab attempt, rate limit hit, dll)
 */
const DB_LOGGED_EVENTS = new Set([
  'RATE_LIMIT_HIT',
  'INVALID_MOVE_TOKEN',
  'NO_TOKEN_ISSUED',
  'MULTI_TAB_ATTEMPT',
  'UNAUTHORIZED_MOVE_ATTEMPT',
  'MULTI_ACCOUNT_DETECTED',
  'REALTIME_SUSPICIOUS',
]);

function logSecurityEvent(eventType, details) {
  console.warn('[SECURITY]', eventType, JSON.stringify(details));

  if (DB_LOGGED_EVENTS.has(eventType)) {
    const sql = `INSERT INTO security_events (event_type, user_id, details) VALUES ($1, $2, $3)`;
    query(sql, [
      eventType, 
      details.userId || null, 
      JSON.stringify(details)
    ]).catch(e => console.error('[AUDIT] security_events write failed:', e.message));
  }
}

module.exports = { logMove, logAnticheatAction, logSecurityEvent };
