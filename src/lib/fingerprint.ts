/**
 * IP / Device Fingerprinting — Multi-Account Detection
 */

import crypto from 'crypto';
import { Socket } from 'socket.io';
import prisma from './prisma';

// ── Helpers ────────────────────────────────────────────────────────────────

function sha256(str: string) {
  return crypto
    .createHash('sha256')
    .update(str || '')
    .digest('hex');
}

export function extractIp(socket: Socket) {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  if (forwarded) {
    return Array.isArray(forwarded)
      ? forwarded[0].split(',')[0].trim()
      : forwarded.split(',')[0].trim();
  }
  return socket.handshake.address || 'unknown';
}

export function buildFingerprintHash(ip: string, ua: string) {
  return sha256(`${ip}|${ua}`);
}

// ── Core: Record & Detect ──────────────────────────────────────────────────

export async function recordAndDetect(socket: Socket, userId: string, gameId: string | null) {
  const ip = extractIp(socket);
  const ua = (socket.handshake.headers['user-agent'] as string) || 'unknown';

  const fingerprintHash = buildFingerprintHash(ip, ua);
  const ipHash = sha256(ip);
  const uaHash = sha256(ua);

  // Upsert record fingerprint
  const insertPromise = prisma.deviceFingerprint
    .upsert({
      where: {
        user_id_fingerprint_hash: {
          user_id: userId,
          fingerprint_hash: fingerprintHash,
        },
      },
      update: {
        seen_at: new Date(),
        game_id: gameId,
      },
      create: {
        user_id: userId,
        fingerprint_hash: fingerprintHash,
        ip_hash: ipHash,
        ua_hash: uaHash,
        game_id: gameId,
        seen_at: new Date(),
      },
    })
    .catch((e) => console.error('[Fingerprint] DB upsert failed:', e.message));

  let isMultiAccount = false;
  let suspectedUserIds: string[] = [];

  try {
    const matches = await prisma.deviceFingerprint.findMany({
      where: {
        fingerprint_hash: fingerprintHash,
        user_id: { not: userId },
      },
      select: { user_id: true },
      take: 10,
    });

    if (matches.length > 0) {
      isMultiAccount = true;
      suspectedUserIds = [...new Set(matches.map((m) => m.user_id))];

      console.warn('[FINGERPRINT] Multi-account detected:', {
        userId,
        sharedFingerprintWith: suspectedUserIds,
        fingerprintHash: fingerprintHash.slice(0, 12) + '…',
        gameId,
      });

      for (const otherUserId of suspectedUserIds) {
        const userA = userId < otherUserId ? userId : otherUserId;
        const userB = userId < otherUserId ? otherUserId : userId;

        await prisma.multiAccountFlag
          .upsert({
            where: {
              user_id_a_user_id_b_fingerprint_hash: {
                user_id_a: userA,
                user_id_b: userB,
                fingerprint_hash: fingerprintHash,
              },
            },
            update: {}, // Do nothing if already exists
            create: {
              user_id_a: userA,
              user_id_b: userB,
              fingerprint_hash: fingerprintHash,
              detected_at: new Date(),
              reviewed: false,
            },
          })
          .catch((e) =>
            console.error('[Fingerprint] multi_account_flags upsert failed:', e.message),
          );
      }
    }
  } catch (e: any) {
    console.error('[Fingerprint] Detection query failed:', e.message);
  }

  await insertPromise;

  return { isMultiAccount, suspectedUserIds, fingerprintHash };
}

export function scoreFingerprintResult({
  isMultiAccount,
  suspectedUserIds,
}: {
  isMultiAccount: boolean;
  suspectedUserIds: string[];
}) {
  if (!isMultiAccount) return { flags: [], score: 0 };

  const count = suspectedUserIds.length;
  const score = count >= 3 ? 50 : count >= 2 ? 35 : 25;
  const flags = [`MULTI_ACCOUNT_IP:${count}shared`];

  return { flags, score };
}
