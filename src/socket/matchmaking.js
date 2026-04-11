/**
 * Matchmaking socket handlers
 * Events: queue:join, queue:leave → game:found
 * Uses Supabase DB for persistence, in-memory queue for speed
 */

const { users, wallets, games } = require('../lib/db');

// In-memory queue: Map<queueKey, Array<{ userId, socketId, elo, joinedAt }>>
const queues = new Map();

function queueKey(timeControl, stakes) {
  return `${timeControl.initial}-${timeControl.increment}-${stakes || 0}`;
}

function registerMatchmaking(io, socket, userId) {
  // ── Join matchmaking queue ──────────────────────────────────────────────
  socket.on('queue:join', async ({ timeControl, stakes = 0, color }) => {
    try {
      const user = await users.findById(userId);
      if (!user) return socket.emit('error', { message: 'User not found' });

      // Check active game — don't allow joining queue while in a game
      const activeGame = await games.findActiveByUser(userId);
      if (activeGame) {
        return socket.emit('error', { message: 'You already have an active game' });
      }

      // Check balance for paid matches
      if (stakes > 0) {
        const wallet = await wallets.getBalance(userId);
        const available = wallet.balance - wallet.locked;
        if (available < stakes) {
          return socket.emit('error', { message: 'Insufficient balance for this stake' });
        }
        // Lock the stake
        await wallets.lock(userId, stakes);
      }

      const key = queueKey(timeControl, stakes);
      if (!queues.has(key)) queues.set(key, []);
      const queue = queues.get(key);

      // Remove any existing entry for this user
      const existingIdx = queue.findIndex(e => e.userId === userId);
      if (existingIdx !== -1) queue.splice(existingIdx, 1);

      queue.push({ userId, socketId: socket.id, elo: user.elo, joinedAt: Date.now() });

      socket.emit('queue:joined', { queueKey: key, position: queue.length });
      console.log(`[Queue] ${user.username} (${user.elo}) joined: ${key}`);

      // Try pairing
      await tryPairPlayers(io, key, timeControl, stakes, color);
    } catch (err) {
      console.error('[queue:join]', err);
      socket.emit('error', { message: 'Failed to join queue' });
    }
  });

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

async function tryPairPlayers(io, key, timeControl, stakes, preferredColor) {
  const queue = queues.get(key);
  if (!queue || queue.length < 2) return;

  // ELO-based pairing: find closest ELO match
  const now = Date.now();
  let bestPair = null;
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
  const q = queues.get(key);
  queues.set(key, q.filter(e => e.userId !== p1.userId && e.userId !== p2.userId));

  // Assign colors
  const whiteIsP1 = preferredColor === 'white' || Math.random() > 0.5;
  const whiteEntry = whiteIsP1 ? p1 : p2;
  const blackEntry = whiteIsP1 ? p2 : p1;

  try {
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
      stakes,
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

    console.log(`[Match] ${whiteUser.username} vs ${blackUser.username} — Game ${game.id} (stakes: ${stakes})`);
  } catch (err) {
    console.error('[matchmaking/pair]', err);
  }
}

function removeFromAllQueues(userId) {
  for (const [key, queue] of queues.entries()) {
    const idx = queue.findIndex(e => e.userId === userId);
    if (idx !== -1) {
      queue.splice(idx, 1);
      console.log(`[Queue] Removed user ${userId} from ${key}`);
    }
  }
}

// Export queues for health endpoint
module.exports = { registerMatchmaking, queues };
