/**
 * IP / Device Fingerprinting — Multi-Account Detection
 */

const crypto = require('crypto');
const { query } = require('./db');

// ── Helpers ────────────────────────────────────────────────────────────────

function sha256(str) {
  return crypto.createHash('sha256').update(str || '').digest('hex');
}

function extractIp(socket) {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return socket.handshake.address || 'unknown';
}

function buildFingerprintHash(ip, ua) {
  return sha256(`${ip}|${ua}`);
}

// ── Core: Record & Detect ──────────────────────────────────────────────────

async function recordAndDetect(socket, userId, gameId) {
  const ip = extractIp(socket);
  const ua = socket.handshake.headers['user-agent'] || 'unknown';

  const fingerprintHash = buildFingerprintHash(ip, ua);
  const ipHash = sha256(ip);
  const uaHash = sha256(ua);

  // Upsert record fingerprint
  const insertSql = `
    INSERT INTO device_fingerprints (user_id, fingerprint_hash, ip_hash, ua_hash, game_id, seen_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    ON CONFLICT (user_id, fingerprint_hash) DO UPDATE 
    SET seen_at = NOW(), game_id = $5
  `;
  const insertPromise = query(insertSql, [userId, fingerprintHash, ipHash, uaHash, gameId])
    .catch(e => console.error('[Fingerprint] DB insert failed:', e.message));

  let isMultiAccount = false;
  let suspectedUserIds = [];

  try {
    const matchesRes = await query(`
      SELECT user_id FROM device_fingerprints
      WHERE fingerprint_hash = $1 AND user_id != $2
      LIMIT 10
    `, [fingerprintHash, userId]);

    if (matchesRes.rowCount > 0) {
      isMultiAccount = true;
      suspectedUserIds = [...new Set(matchesRes.rows.map(m => m.user_id))];

      console.warn('[FINGERPRINT] Multi-account detected:', {
        userId,
        sharedFingerprintWith: suspectedUserIds,
        fingerprintHash: fingerprintHash.slice(0, 12) + '…',
        gameId,
      });

      for (const otherUserId of suspectedUserIds) {
        const userA = userId < otherUserId ? userId : otherUserId;
        const userB = userId < otherUserId ? otherUserId : userId;
        
        await query(`
          INSERT INTO multi_account_flags (user_id_a, user_id_b, fingerprint_hash, detected_at, reviewed)
          VALUES ($1, $2, $3, NOW(), false)
          ON CONFLICT (user_id_a, user_id_b, fingerprint_hash) DO NOTHING
        `, [userA, userB, fingerprintHash]).catch(e => console.error('[Fingerprint] multi_account_flags insert failed:', e.message));
      }
    }
  } catch (e) {
    console.error('[Fingerprint] Detection query failed:', e.message);
  }

  await insertPromise;

  return { isMultiAccount, suspectedUserIds, fingerprintHash };
}

function scoreFingerprintResult({ isMultiAccount, suspectedUserIds }) {
  if (!isMultiAccount) return { flags: [], score: 0 };

  const count = suspectedUserIds.length;
  const score = count >= 3 ? 50 : count >= 2 ? 35 : 25;
  const flags = [`MULTI_ACCOUNT_IP:${count}shared`];

  return { flags, score };
}

module.exports = { recordAndDetect, scoreFingerprintResult, extractIp, buildFingerprintHash };
