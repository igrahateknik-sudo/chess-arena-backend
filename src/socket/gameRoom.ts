/**
 * Game room socket handlers — Server-Authoritative Chess Engine
 */

import { Server, Socket } from 'socket.io';
import crypto from 'crypto';
import { Chess } from 'chess.js';
import { games, users, wallets, notifications } from '../lib/db';
import { calculateBothElo } from '../lib/elo';
import {
  analyzeGame,
  analyzeRealtime,
  enforceAnticheat,
  runStockfishBackground,
} from '../lib/anticheat';
import { netWinnings } from '../lib/ipaymu';
import { logMove, logSecurityEvent } from '../lib/auditLog';
import { recordAndDetect, scoreFingerprintResult } from '../lib/fingerprint';
import { runCollusionDetection } from '../lib/collusion';
import redis from '../lib/redis';
import prisma from '../lib/prisma';
import logger from '../lib/logger';

interface GameState {
  id: string;
  fen: string;
  whiteTimeLeft: number;
  blackTimeLeft: number;
  moveHistory: any[];
  status: string;
  whiteId: string;
  blackId: string;
  timeControl: any;
  stakes: string;
  whiteEloBefore: number | null;
  blackEloBefore: number | null;
  drawOfferedBy: string | null;
  lastMoveAt: number;
}

// ── In-memory state maps for instance-specific connections ───────────────
const timers = new Map<string, NodeJS.Timeout>();
const disconnectTimers = new Map<string, NodeJS.Timeout>();
const moveCooldowns = new Map<string, number>();
const MOVE_COOLDOWN_MS = 500;
const activeGameSockets = new Map<string, string>();
const socketGameRooms = new Map<string, { gameId: string; userId: string }[]>();

function generateMoveToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

async function getGameState(gameId: string): Promise<GameState | null> {
  try {
    const cached = await redis.get(`game:${gameId}:state`);
    if (cached) return JSON.parse(cached);
  } catch (err: any) {
    logger.error(`[Redis:GetState] Parse error for ${gameId}: ${err.message}`);
  }

  const game = await games.findById(gameId);
  if (!game) return null;

  const state: GameState = {
    id: game.id,
    fen: game.fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    whiteTimeLeft: game.white_time_left || 600,
    blackTimeLeft: game.black_time_left || 600,
    moveHistory: (game.move_history as any[]) || [],
    status: game.status || 'active',
    whiteId: game.white_id || '',
    blackId: game.black_id || '',
    timeControl: game.time_control,
    stakes: (game.stakes || 0n).toString(),
    whiteEloBefore: game.white_elo_before,
    blackEloBefore: game.black_elo_before,
    drawOfferedBy: null,
    lastMoveAt: Date.now(),
  };

  try {
    await redis.set(`game:${gameId}:state`, JSON.stringify(state));
    await redis.set(`game:${gameId}:seq`, state.moveHistory.length);
  } catch (err: any) {
    logger.error(`[Redis:SetState] Error for ${gameId}: ${err.message}`);
  }
  return state;
}

async function updateGameState(gameId: string, updates: Partial<GameState>): Promise<void> {
  const state = await getGameState(gameId);
  if (state) {
    Object.assign(state, updates);
    await redis.set(`game:${gameId}:state`, JSON.stringify(state));
  }
}

function startTimer(io: Server, gameId: string): void {
  if (timers.has(gameId)) return;

  const interval = setInterval(async () => {
    const game = await getGameState(gameId);
    if (!game || game.status !== 'active') {
      clearInterval(interval);
      timers.delete(gameId);
      return;
    }

    const turn = game.fen.split(' ')[1];

    if (turn === 'w') {
      const newTime = Math.max(0, game.whiteTimeLeft - 1);
      await updateGameState(gameId, { whiteTimeLeft: newTime });
      io.to(gameId).emit('game:clock', {
        whiteTimeLeft: newTime,
        blackTimeLeft: game.blackTimeLeft,
        turn: 'w',
      });
      if (newTime === 0) {
        clearInterval(interval);
        timers.delete(gameId);
        endGame(io, gameId, 'black', 'timeout');
      }
    } else {
      const newTime = Math.max(0, game.blackTimeLeft - 1);
      await updateGameState(gameId, { blackTimeLeft: newTime });
      io.to(gameId).emit('game:clock', {
        whiteTimeLeft: game.whiteTimeLeft,
        blackTimeLeft: newTime,
        turn: 'b',
      });
      if (newTime === 0) {
        clearInterval(interval);
        timers.delete(gameId);
        endGame(io, gameId, 'white', 'timeout');
      }
    }
  }, 1000);

  timers.set(gameId, interval);
}

function stopTimer(gameId: string): void {
  const interval = timers.get(gameId);
  if (interval) {
    clearInterval(interval);
    timers.delete(gameId);
  }
}

async function endGame(
  io: Server,
  gameId: string,
  winner: 'white' | 'black' | 'draw',
  endReason: string,
): Promise<void> {
  const game = await getGameState(gameId);
  if (!game || game.status !== 'active') return;

  await updateGameState(gameId, { status: 'finished' });
  const stakesBigInt = BigInt(game.stakes);

  try {
    const whiteUser = await users.findById(game.whiteId);
    const blackUser = await users.findById(game.blackId);
    if (!whiteUser || !blackUser) return;

    const eloResult = winner === 'draw' ? 'draw' : winner === 'white' ? 'white' : 'black';
    const { whiteChange, blackChange } = calculateBothElo(
      game.whiteEloBefore || whiteUser.elo || 800,
      game.blackEloBefore || blackUser.elo || 800,
      eloResult,
    );

    const newWhiteElo = Math.max(100, (whiteUser.elo || 800) + whiteChange);
    const newBlackElo = Math.max(100, (blackUser.elo || 800) + blackChange);

    // ── CRITICAL TRANSACTION (Game, Wallet, ELO) ───────────────────────────
    // Semua operasi ini harus terjadi secara atomik.
    await prisma.$transaction(async (tx) => {
      // 1. Update status game & ELO hasil akhir
      await tx.game.update({
        where: { id: gameId },
        data: {
          status: 'finished',
          winner,
          end_reason: endReason,
          fen: game.fen,
          move_history: game.moveHistory,
          white_elo_after: newWhiteElo,
          black_elo_after: newBlackElo,
          white_time_left: game.whiteTimeLeft,
          black_time_left: game.blackTimeLeft,
          ended_at: new Date(),
        },
      });

      // 2. Update ELO users
      await tx.user.update({
        where: { id: game.whiteId },
        data: {
          elo: newWhiteElo,
          games_played: { increment: 1 },
          wins: { increment: winner === 'white' ? 1 : 0 },
          losses: { increment: winner === 'black' ? 1 : 0 },
          draws: { increment: winner === 'draw' ? 1 : 0 },
        },
      });
      await tx.user.update({
        where: { id: game.blackId },
        data: {
          elo: newBlackElo,
          games_played: { increment: 1 },
          wins: { increment: winner === 'black' ? 1 : 0 },
          losses: { increment: winner === 'white' ? 1 : 0 },
          draws: { increment: winner === 'draw' ? 1 : 0 },
        },
      });

      // 3. Payout Wallet (Jika ada taruhan)
      if (stakesBigInt > 0n) {
        const { fee } = netWinnings(Number(stakesBigInt * 2n));
        const feeBigInt = BigInt(fee);
        const winnerId =
          winner === 'white' ? game.whiteId : winner === 'black' ? game.blackId : null;
        const loserId =
          winner === 'white' ? game.blackId : winner === 'black' ? game.whiteId : null;

        // Panggil fungsi RPC database untuk atomisitas level DB
        await tx.$queryRaw`SELECT settle_game_payout(
          ${winnerId}::uuid, 
          ${loserId}::uuid, 
          ${game.whiteId}::uuid, 
          ${game.blackId}::uuid, 
          ${stakesBigInt}, 
          ${feeBigInt}
        )`;

        // Catat Transaksi untuk histori
        if (winner !== 'draw' && winnerId && loserId) {
          const winnerUser = winner === 'white' ? whiteUser : blackUser;
          const loserUser = winner === 'white' ? blackUser : whiteUser;

          await tx.transaction.create({
            data: {
              user_id: winnerId,
              type: 'game-win',
              amount: stakesBigInt - feeBigInt,
              status: 'completed',
              description: `Won vs ${loserUser.username} (+${stakesBigInt - feeBigInt} after ${feeBigInt} fee)`,
              game_id: gameId,
            },
          });
          await tx.transaction.create({
            data: {
              user_id: loserId,
              type: 'game-loss',
              amount: -stakesBigInt,
              status: 'completed',
              description: `Lost vs ${winnerUser.username}`,
              game_id: gameId,
            },
          });
        } else {
          await tx.transaction.create({
            data: {
              user_id: game.whiteId,
              type: 'game-draw',
              amount: 0n,
              status: 'completed',
              description: `Draw vs ${blackUser.username}`,
              game_id: gameId,
            },
          });
          await tx.transaction.create({
            data: {
              user_id: game.blackId,
              type: 'game-draw',
              amount: 0n,
              status: 'completed',
              description: `Draw vs ${whiteUser.username}`,
              game_id: gameId,
            },
          });
        }
      }

      // 4. Catat ELO History
      await tx.eloHistory.create({
        data: {
          user_id: game.whiteId,
          elo_before: game.whiteEloBefore || whiteUser.elo || 800,
          elo_after: newWhiteElo,
          change: whiteChange,
          game_id: gameId,
        },
      });
      await tx.eloHistory.create({
        data: {
          user_id: game.blackId,
          elo_before: game.blackEloBefore || blackUser.elo || 800,
          elo_after: newBlackElo,
          change: blackChange,
          game_id: gameId,
        },
      });
    });

    // ── NON-CRITICAL POST-TRANSACTION (Anti-cheat, Notify) ─────────────────

    // 1. Notify Client (Sangat cepat agar pemain segera lihat result)
    io.to(gameId).emit('game:over', {
      gameId,
      winner,
      endReason,
      eloChanges: { [game.whiteId]: whiteChange, [game.blackId]: blackChange },
      whiteElo: newWhiteElo,
      blackElo: newBlackElo,
      stakes: game.stakes.toString(),
    });

    // 2. Background Anti-cheat Analysis (Tidak perlu menunggu selesai)
    (async () => {
      try {
        const anticheatResult = analyzeGame({ move_history: game.moveHistory });
        const allFlags = [...anticheatResult.white.flags, ...anticheatResult.black.flags];

        // Simpan flag anomali awal
        const flagsForDb = [];
        if (anticheatResult.white.suspicious)
          flagsForDb.push({
            color: 'white',
            flags: anticheatResult.white.flags,
            score: anticheatResult.white.score,
          });
        if (anticheatResult.black.suspicious)
          flagsForDb.push({
            color: 'black',
            flags: anticheatResult.black.flags,
            score: anticheatResult.black.score,
          });

        await games.update(gameId, { anticheat_flags: flagsForDb });

        // Jalankan background detectors (Stockfish, Collusion, dll)
        runStockfishBackground(gameId, game.moveHistory, allFlags, io).catch((e) =>
          console.error('[SF-bg]', e),
        );
        runCollusionDetection(gameId, game.whiteId, game.blackId, game.moveHistory, winner).catch(
          (e) => console.error('[Coll-bg]', e),
        );

        // Enforce basic flags
        if (anticheatResult.white.suspicious)
          await enforceAnticheat(game.whiteId, gameId, anticheatResult.white, io);
        if (anticheatResult.black.suspicious)
          await enforceAnticheat(game.blackId, gameId, anticheatResult.black, io);
      } catch (e) {
        console.error('[Bg-analysis-error]', e);
      }
    })();

    // 3. Update Wallet & Notif UI
    Promise.all([
      wallets.getBalance(game.whiteId),
      wallets.getBalance(game.blackId),
      notifications.getUnread(game.whiteId),
      notifications.getUnread(game.blackId),
    ])
      .then(([wBal, bBal, wNotif, bNotif]) => {
        io.to(game.whiteId).emit('wallet:update', {
          balance: wBal.balance?.toString(),
          locked: wBal.locked?.toString(),
        });
        io.to(game.blackId).emit('wallet:update', {
          balance: bBal.balance?.toString(),
          locked: bBal.locked?.toString(),
        });
        if (wNotif.length) io.to(game.whiteId).emit('notification:new', { notifications: wNotif });
        if (bNotif.length) io.to(game.blackId).emit('notification:new', { notifications: bNotif });
      })
      .catch((e) => console.error('[Post-game UI update]', e));

    // Cleanup Redis cache
    await redis.del(`token:${gameId}:${game.whiteId}`);
    await redis.del(`token:${gameId}:${game.blackId}`);
    setTimeout(() => {
      redis.del(`game:${gameId}:state`).catch(() => {});
      redis.del(`game:${gameId}:seq`).catch(() => {});
    }, 60_000);
  } catch (err) {
    console.error('[endGame Fatal Error]', err);
    // Jika transaksi gagal, kita usahakan untuk setidaknya beri kabar ke client
    io.to(gameId).emit('error', {
      message: 'Game ended with an internal error. Please check your history/balance.',
    });
  }
}

export function registerGameRoom(io: Server, socket: Socket, userId: string): void {
  socket.on('game:join', async ({ gameId }: { gameId: string }) => {
    try {
      const game = await getGameState(gameId);
      if (!game) return socket.emit('error', { message: 'Game not found' });
      if (game.whiteId !== userId && game.blackId !== userId) {
        return socket.emit('error', { message: 'Not a player in this game' });
      }

      const sessionKey = `${gameId}:${userId}`;
      const existingSocketId = activeGameSockets.get(sessionKey);

      if (existingSocketId && existingSocketId !== socket.id) {
        const existingSocket = io.sockets.sockets.get(existingSocketId);
        if (existingSocket) {
          logSecurityEvent('MULTI_TAB_ATTEMPT', {
            userId,
            gameId,
            oldSocketId: existingSocketId,
            newSocketId: socket.id,
          });
          existingSocket.emit('session:displaced', {
            message: 'Sesi game kamu dibuka di tab/perangkat lain. Tab ini tidak aktif lagi.',
          });
          existingSocket.leave(gameId);
          const oldRooms = socketGameRooms.get(existingSocketId) || [];
          socketGameRooms.set(
            existingSocketId,
            oldRooms.filter((r) => r.gameId !== gameId),
          );
        }
      }

      activeGameSockets.set(sessionKey, socket.id);

      const currentRooms = socketGameRooms.get(socket.id) || [];
      if (!currentRooms.find((r) => r.gameId === gameId)) {
        currentRooms.push({ gameId, userId });
        socketGameRooms.set(socket.id, currentRooms);
      }

      socket.join(gameId);

      const dcKey = `${gameId}:${userId}`;
      const dcTimer = disconnectTimers.get(dcKey);
      if (dcTimer) {
        clearTimeout(dcTimer);
        disconnectTimers.delete(dcKey);
        socket.to(gameId).emit('opponent:reconnected', { userId });
      }

      const room = io.sockets.adapter.rooms.get(gameId);
      if (room && room.size >= 2 && game.status === 'active') {
        startTimer(io, gameId);
      }

      const tokenKey = `token:${gameId}:${userId}`;
      const initialToken = generateMoveToken();
      await redis.set(tokenKey, initialToken);

      recordAndDetect(socket, userId, gameId)
        .then(async (fpResult) => {
          if (fpResult.isMultiAccount) {
            const fpScore = scoreFingerprintResult(fpResult);
            logSecurityEvent('MULTI_ACCOUNT_DETECTED', {
              userId,
              gameId,
              sharedWith: fpResult.suspectedUserIds,
              fingerprintHash: fpResult.fingerprintHash.slice(0, 12) + '…',
            });
            enforceAnticheat(userId, gameId, fpScore, io).catch((e) =>
              console.error('[Fingerprint:enforce]', e.message),
            );
          }
        })
        .catch((e) => console.error('[Fingerprint:detect]', e.message));

      socket.emit('game:state', {
        gameId,
        fen: game.fen,
        moveHistory: game.moveHistory,
        whiteTimeLeft: game.whiteTimeLeft,
        blackTimeLeft: game.blackTimeLeft,
        status: game.status,
        playerColor: game.whiteId === userId ? 'white' : 'black',
        nextMoveToken: initialToken,
      });

      socket.to(gameId).emit('opponent:connected', { userId });
      console.log(`[Room] ${userId} joined game ${gameId} (socket: ${socket.id})`);
    } catch (err) {
      console.error('[game:join]', err);
      socket.emit('error', { message: 'Failed to join game' });
    }
  });

  socket.on(
    'game:move',
    async ({
      gameId,
      from,
      to,
      promotion,
      moveToken,
    }: {
      gameId: string;
      from: string;
      to: string;
      promotion?: string;
      moveToken: string;
    }) => {
      const serverTs = Date.now();
      const game = await getGameState(gameId);

      if (!game || game.status !== 'active') {
        return socket.emit('move:invalid', { reason: 'Game not active' });
      }

      const sessionKey = `${gameId}:${userId}`;
      const registeredSocketId = activeGameSockets.get(sessionKey);
      if (registeredSocketId && registeredSocketId !== socket.id) {
        logSecurityEvent('UNAUTHORIZED_MOVE_ATTEMPT', {
          userId,
          gameId,
          attemptingSocket: socket.id,
          registeredSocket: registeredSocketId,
        });
        return socket.emit('move:invalid', { reason: 'Session tidak valid. Refresh halaman.' });
      }

      const lastMoveTs = moveCooldowns.get(userId) || 0;
      if (serverTs - lastMoveTs < MOVE_COOLDOWN_MS) {
        logSecurityEvent('RATE_LIMIT_HIT', {
          userId,
          gameId,
          timeSinceLast: serverTs - lastMoveTs,
        });
        return socket.emit('move:invalid', { reason: 'Terlalu cepat. Tunggu sebentar.' });
      }

      const tokenKey = `token:${gameId}:${userId}`;
      const expectedToken = await redis.get(tokenKey);

      let currentSeq = parseInt((await redis.get(`game:${gameId}:seq`)) || '0', 10);

      if (!expectedToken) {
        logSecurityEvent('NO_TOKEN_ISSUED', {
          userId,
          gameId,
          providedToken: moveToken || '(none)',
          seq: currentSeq,
        });
        return socket.emit('move:invalid', {
          reason: 'Session tidak valid. Mohon refresh dan join ulang.',
          requestTokenRefresh: true,
        });
      }

      if (moveToken !== expectedToken) {
        logSecurityEvent('INVALID_MOVE_TOKEN', {
          userId,
          gameId,
          provided: moveToken || '(none)',
          expected: expectedToken,
          seq: currentSeq,
        });
        return socket.emit('move:invalid', {
          reason: 'Token tidak valid. Kemungkinan replay attack atau session expired.',
          requestTokenRefresh: true,
        });
      }

      const isWhite = game.whiteId === userId;
      const isBlack = game.blackId === userId;
      const turn = game.fen.split(' ')[1];
      if ((turn === 'w' && !isWhite) || (turn === 'b' && !isBlack)) {
        return socket.emit('move:invalid', { reason: 'Not your turn' });
      }

      const chess = new Chess(game.fen);
      let move;
      try {
        move = chess.move({ from, to, promotion: promotion || 'q' });
      } catch {
        return socket.emit('move:invalid', { reason: 'Illegal move' });
      }
      if (!move) return socket.emit('move:invalid', { reason: 'Illegal move' });

      moveCooldowns.set(userId, serverTs);

      const newToken = generateMoveToken();
      await redis.set(tokenKey, newToken);
      socket.emit('move:token', { nextMoveToken: newToken });

      const increment = game.timeControl?.increment || 0;
      let { whiteTimeLeft, blackTimeLeft } = game;
      if (turn === 'w')
        whiteTimeLeft = Math.min(whiteTimeLeft + increment, (game.timeControl?.initial || 600) * 2);
      else
        blackTimeLeft = Math.min(blackTimeLeft + increment, (game.timeControl?.initial || 600) * 2);

      const timeTakenMs = game.lastMoveAt ? serverTs - game.lastMoveAt : 0;

      currentSeq += 1;
      await redis.set(`game:${gameId}:seq`, currentSeq.toString());

      const moveRecord = {
        san: move.san,
        from: move.from,
        to: move.to,
        piece: move.piece,
        captured: move.captured,
        promotion: move.promotion,
        timestamp: serverTs,
        whiteTimeLeft,
        blackTimeLeft,
        seq: currentSeq,
      };

      const newMoveHistory = [...game.moveHistory, moveRecord];

      await updateGameState(gameId, {
        fen: chess.fen(),
        moveHistory: newMoveHistory,
        whiteTimeLeft,
        blackTimeLeft,
        lastMoveAt: serverTs,
      });

      logMove({
        gameId,
        userId,
        moveSeq: currentSeq,
        san: move.san,
        from: move.from,
        to: move.to,
        fenAfter: chess.fen(),
        timeTakenMs,
        timeLeft: isWhite ? whiteTimeLeft : blackTimeLeft,
        serverTs: serverTs,
      });

      io.to(gameId).emit('game:move', {
        move: moveRecord,
        fen: chess.fen(),
        whiteTimeLeft,
        blackTimeLeft,
      });

      if (newMoveHistory.length > 0 && newMoveHistory.length % 10 === 0) {
        try {
          const realtimeResult = analyzeRealtime(newMoveHistory);
          const playerColor = isWhite ? 'white' : 'black';
          const playerResult = (realtimeResult as any)[playerColor];

          if (playerResult && playerResult.suspicious) {
            logSecurityEvent('REALTIME_SUSPICIOUS', {
              userId,
              gameId,
              moveSeq: currentSeq,
              flags: playerResult.flags,
              score: playerResult.score,
              stats: playerResult.stats,
            });
          }
        } catch (e) {
          console.error('[anticheat:realtime]', e);
        }
      }

      if (chess.isCheckmate()) {
        stopTimer(gameId);
        endGame(io, gameId, turn === 'w' ? 'white' : 'black', 'checkmate');
      } else if (
        chess.isDraw() ||
        chess.isStalemate() ||
        chess.isThreefoldRepetition() ||
        chess.isInsufficientMaterial()
      ) {
        stopTimer(gameId);
        const reason = chess.isStalemate()
          ? 'stalemate'
          : chess.isThreefoldRepetition()
            ? 'repetition'
            : chess.isInsufficientMaterial()
              ? 'insufficient'
              : 'fifty-move';
        endGame(io, gameId, 'draw', reason);
      }
    },
  );

  socket.on('game:resign', async ({ gameId }: { gameId: string }) => {
    const game = await getGameState(gameId);
    if (!game || game.status !== 'active') return;
    if (game.whiteId !== userId && game.blackId !== userId) return;

    stopTimer(gameId);
    const winner = game.whiteId === userId ? 'black' : 'white';
    endGame(io, gameId, winner, 'resign');
  });

  socket.on('game:draw-offer', async ({ gameId }: { gameId: string }) => {
    const game = await getGameState(gameId);
    if (!game || game.status !== 'active') return;
    await updateGameState(gameId, { drawOfferedBy: userId });
    socket.to(gameId).emit('game:draw-offered', { by: userId });
  });

  socket.on('game:draw-accept', async ({ gameId }: { gameId: string }) => {
    const game = await getGameState(gameId);
    if (!game || game.status !== 'active' || !game.drawOfferedBy) return;
    stopTimer(gameId);
    endGame(io, gameId, 'draw', 'draw-agreement');
  });

  socket.on('game:draw-decline', async ({ gameId }: { gameId: string }) => {
    await updateGameState(gameId, { drawOfferedBy: null });
    socket.to(gameId).emit('game:draw-declined');
  });

  socket.on('disconnect', async () => {
    moveCooldowns.delete(userId);

    const rooms = socketGameRooms.get(socket.id) || [];
    for (const { gameId } of rooms) {
      const sessionKey = `${gameId}:${userId}`;
      if (activeGameSockets.get(sessionKey) === socket.id) {
        activeGameSockets.delete(sessionKey);
      }
      await redis.del(`token:${gameId}:${userId}`);
    }
    socketGameRooms.delete(socket.id);

    for (const { gameId } of rooms) {
      const game = await getGameState(gameId);
      if (!game || game.status !== 'active') continue;
      if (game.whiteId !== userId && game.blackId !== userId) continue;

      socket.to(gameId).emit('opponent:disconnected', { userId, reconnectWindow: 60 });

      const dcKey = `${gameId}:${userId}`;
      const dcTimer = setTimeout(async () => {
        disconnectTimers.delete(dcKey);
        const currentGame = await getGameState(gameId);
        if (!currentGame || currentGame.status !== 'active') return;

        const room = io.sockets.adapter.rooms.get(gameId);
        if (!room || room.size === 0) {
          stopTimer(gameId);
          endGame(io, gameId, 'draw', 'aborted');
        } else {
          stopTimer(gameId);
          const winner = game.whiteId === userId ? 'black' : 'white';
          endGame(io, gameId, winner, 'disconnect');
        }
      }, 60_000);

      disconnectTimers.set(dcKey, dcTimer);
    }
  });
}
