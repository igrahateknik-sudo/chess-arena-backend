/**
 * Audit Trail Logger
 * Setiap move yang diterima server dicatat secara immutable:
 * - ke console (structured JSON, always works)
 * - ke database move_audit_log (non-blocking, fail silently)
 */

import prisma from './prisma';

interface LogMoveParams {
  gameId: string;
  userId: string;
  moveSeq: number; // nomor urut move dalam game (1, 2, 3, ...)
  san: string; // notasi standar: e4, Nf3, O-O, dll
  from: string; // e2
  to: string; // e4
  fenAfter: string; // FEN setelah move dieksekusi
  timeTakenMs: number; // waktu dari move sebelumnya (ms)
  timeLeft: number; // sisa waktu player (ms)
  serverTs: number; // Date.now() saat server menerima event
}

/**
 * Log satu move yang sudah divalidasi dan diterima server
 */
export async function logMove({
  gameId,
  userId,
  moveSeq,
  san,
  from,
  to,
  fenAfter,
  timeTakenMs,
  timeLeft,
  serverTs,
}: LogMoveParams) {
  const entry = {
    game_id: gameId,
    user_id: userId,
    move_seq: moveSeq,
    san,
    from_sq: from,
    to_sq: to,
    fen_after: fenAfter,
    time_taken_ms: timeTakenMs,
    time_left: timeLeft,
    server_ts: BigInt(serverTs),
  };

  // Selalu log ke console sebagai audit trail primer
  console.log('[AUDIT:MOVE]', JSON.stringify({ ...entry, server_ts: serverTs }));

  // Persist ke DB (non-blocking)
  prisma.moveAuditLog
    .create({
      data: entry,
    })
    .catch((e) => console.error('[AUDIT] DB write failed:', e.message));
}

interface LogAnticheatActionParams {
  userId: string;
  gameId: string | null;
  action: string; // 'warn' | 'flag' | 'suspend'
  reason: string;
  flags: string[]; // array of flag strings
  score: number; // suspicion score 0–100
}

/**
 * Log tindakan anti-cheat (peringatan, flag, suspend)
 */
export async function logAnticheatAction({
  userId,
  gameId,
  action,
  reason,
  flags,
  score,
}: LogAnticheatActionParams) {
  const entry = {
    user_id: userId,
    game_id: gameId,
    action,
    reason,
    flags: JSON.stringify(flags),
    score,
  };

  console.log('[AUDIT:ANTICHEAT]', JSON.stringify(entry));

  prisma.antiCheatAction
    .create({
      data: entry,
    })
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

export function logSecurityEvent(eventType: string, details: any) {
  console.warn('[SECURITY]', eventType, JSON.stringify(details));

  if (DB_LOGGED_EVENTS.has(eventType)) {
    prisma.securityEvent
      .create({
        data: {
          event_type: eventType,
          user_id: details.userId || null,
          details: JSON.stringify(details),
        },
      })
      .catch((e) => console.error('[AUDIT] security_events write failed:', e.message));
  }
}
