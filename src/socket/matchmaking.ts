/**
 * Matchmaking socket handlers
 * Events: queue:join, queue:leave → game:found
 * Uses Supabase DB for persistence, in-memory queue for speed
 */

import { Server, Socket } from 'socket.io';
import { users, wallets, games } from '../lib/db';
import logger from '../lib/logger';

interface QueueEntry {
  userId: string;
  socketId: string;
  elo: number;
  joinedAt: number;
}

interface TimeControl {
  initial: number;
  increment: number;
}

// In-memory queue: Map<queueKey, Array<{ userId, socketId, elo, joinedAt }>>
const queues: Map<string, QueueEntry[]> = new Map();
const pairingLocks: Set<string> = new Set();

function queueKey(timeControl: TimeControl, stakes: bigint | number): string {
  return `${timeControl.initial}-${timeControl.increment}-${stakes || 0}`;
}

export function registerMatchmaking(io: Server, socket: Socket, userId: string): void {
  // ── Join matchmaking queue ──────────────────────────────────────────────
  socket.on(
    'queue:join',
    async ({
      timeControl,
      stakes = 0,
      color,
    }: {
      timeControl: TimeControl;
      stakes?: number;
      color?: 'white' | 'black';
    }) => {
      try {
        const user = await users.findById(userId);
        if (!user) return socket.emit('error', { message: 'User not found' });

        // Check active game — don't allow joining queue while in a game
        const activeGame = await games.findActiveByUser(userId);
        if (activeGame) {
          return socket.emit('error', { message: 'You already have an active game' });
        }

        const stakesBigInt = BigInt(stakes);

        // Check balance for paid matches
        if (stakesBigInt > 0n) {
          const wallet = await wallets.getBalance(userId);
          const available = BigInt(wallet.balance || 0n) - BigInt(wallet.locked || 0n);
          if (available < stakesBigInt) {
            return socket.emit('error', { message: 'Insufficient balance for this stake' });
          }
          // Lock the stake
          await wallets.lock(userId, stakesBigInt);
        }

        const key = queueKey(timeControl, stakesBigInt);
        if (!queues.has(key)) queues.set(key, []);
        const queue = queues.get(key)!;

        // Remove any existing entry for this user
        const existingIdx = queue.findIndex((e) => e.userId === userId);
        if (existingIdx !== -1) queue.splice(existingIdx, 1);

        queue.push({ userId, socketId: socket.id, elo: user.elo || 1200, joinedAt: Date.now() });

        socket.emit('queue:joined', { queueKey: key, position: queue.length });
        logger.info(`[Queue] ${user.username} (${user.elo}) joined: ${key}`);

        // Try pairing
        await tryPairPlayers(io, key, timeControl, stakesBigInt, color);
      } catch (err: any) {
        logger.error(`[Queue:Join] Error for user ${userId}: ${err.message}`);
        socket.emit('error', { message: 'Failed to join queue' });
      }
    },
  );

  // ── Leave queue ─────────────────────────────────────────────────────────
  socket.on('queue:leave', async () => {
    removeFromAllQueues(userId);
    socket.emit('queue:left');
  });

  // ── Clean up on disconnect ──────────────────────────────────────────────
  socket.on('disconnect', () => {
    removeFromAllQueues(userId);
  });
}

async function tryPairPlayers(
  io: Server,
  key: string,
  timeControl: TimeControl,
  stakes: bigint,
  preferredColor?: 'white' | 'black',
): Promise<void> {
  if (pairingLocks.has(key)) return;

  const queue = queues.get(key);
  if (!queue || queue.length < 2) return;

  pairingLocks.add(key);

  try {
    // ELO-based pairing: find closest ELO match
    const now = Date.now();
    let bestPair: [QueueEntry, QueueEntry] | null = null;
    let bestDiff = Infinity;

    for (let i = 0; i < queue.length - 1; i++) {
      for (let j = i + 1; j < queue.length; j++) {
        const a = queue[i];
        const b = queue[j];

        // ELO range expands over time (±100 + 5 per second of waiting)
        const waitA = (now - a.joinedAt) / 1000;
        const waitB = (now - b.joinedAt) / 1000;
        const rangeA = 100 + waitA * 5;
        const rangeB = 100 + waitB * 5;
        const diff = Math.abs(a.elo - b.elo);

        if (diff <= Math.max(rangeA, rangeB) && diff < bestDiff) {
          bestDiff = diff;
          bestPair = [a, b];
        }
      }
    }

    if (!bestPair) return;

    const [p1, p2] = bestPair;

    // Remove both from queue
    const q = queues.get(key)!;
    queues.set(
      key,
      q.filter((e) => e.userId !== p1.userId && e.userId !== p2.userId),
    );

    // Assign colors
    const whiteIsP1 = preferredColor === 'white' || Math.random() > 0.5;
    const whiteEntry = whiteIsP1 ? p1 : p2;
    const blackEntry = whiteIsP1 ? p2 : p1;

    const whiteUser = await users.findById(whiteEntry.userId);
    const blackUser = await users.findById(blackEntry.userId);
    if (!whiteUser || !blackUser) return;

    // Create game in DB
    const game = await games.create({
      white_id: whiteEntry.userId,
      black_id: blackEntry.userId,
      time_control: timeControl,
      stakes,
      white_elo_before: whiteUser.elo,
      black_elo_before: blackUser.elo,
      white_time_left: timeControl.initial,
      black_time_left: timeControl.initial,
    });

    const gamePayload = {
      gameId: game.id,
      timeControl,
      stakes: stakes.toString(),
      white: {
        id: whiteEntry.userId,
        username: whiteUser.username,
        elo: whiteUser.elo,
        avatar_url: whiteUser.avatar_url,
        title: whiteUser.title,
      },
      black: {
        id: blackEntry.userId,
        username: blackUser.username,
        elo: blackUser.elo,
        avatar_url: blackUser.avatar_url,
        title: blackUser.title,
      },
      fen: game.fen,
    };

    // Join both sockets to game room
    const whiteSocket = io.sockets.sockets.get(whiteEntry.socketId);
    const blackSocket = io.sockets.sockets.get(blackEntry.socketId);

    if (whiteSocket) whiteSocket.join(game.id);
    if (blackSocket) blackSocket.join(game.id);

    // Notify both
    io.to(game.id).emit('game:found', gamePayload);

    logger.info(
      `[Match] ${whiteUser.username} vs ${blackUser.username} — Game ${game.id} (stakes: ${stakes})`,
    );
  } catch (err: any) {
    logger.error(`[Matchmaking:Pair] Error on key ${key}: ${err.message}`);
  } finally {
    pairingLocks.delete(key);
    // If there are still enough players, try pairing again after a short delay
    const remaining = queues.get(key);
    if (remaining && remaining.length >= 2) {
      setTimeout(() => tryPairPlayers(io, key, timeControl, stakes, preferredColor), 1000);
    }
  }
}

function removeFromAllQueues(userId: string): void {
  for (const [key, queue] of queues.entries()) {
    const idx = queue.findIndex((e) => e.userId === userId);
    if (idx !== -1) {
      queue.splice(idx, 1);
      logger.info(`[Queue] Removed user ${userId} from ${key}`);
    }
  }
}

export { queues };
