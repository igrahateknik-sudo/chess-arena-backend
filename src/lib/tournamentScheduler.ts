/**
 * Tournament Matchmaking & Lifecycle Scheduler
 *
 * Tanggung Jawab:
 * 1. Cari turnamen yang harusnya sudah mulai (starts_at <= NOW)
 * 2. Ubah status jadi 'active'
 * 3. Pasangkan pemain yang terdaftar (Matchmaking ronde 1)
 * 4. Buat record di 'games' dan 'tournament_games'
 * 5. Beri notifikasi ke socket agar pemain masuk ke room
 */

import prisma from './prisma';
import { Server } from 'socket.io';
import logger from './logger';

export async function startTournament(tournamentId: string, io: Server) {
  console.log(`[Tournament] Starting tournament ${tournamentId}...`);

  try {
    // 1. Ambil data turnamen & pemain
    const result = await prisma.$transaction(async (tx) => {
      const tournament = await tx.tournament.findUnique({
        where: { id: tournamentId },
      });

      if (!tournament || tournament.status !== 'upcoming') {
        return { success: false, reason: 'Tournament not found or not upcoming' };
      }

      const registrations = await tx.tournamentRegistration.findMany({
        where: { tournament_id: tournamentId },
        include: {
          user: {
            select: { id: true, username: true, elo: true },
          },
        },
      });

      const players = registrations.map((r) => r.user);

      if (players.length < 2) {
        console.warn(`[Tournament] Not enough players for ${tournamentId}, cancelling.`);
        await tx.tournament.update({
          where: { id: tournamentId },
          data: { status: 'cancelled' },
        });
        return { success: false, reason: 'Not enough players' };
      }

      // 2. Set status jadi ACTIVE
      await tx.tournament.update({
        where: { id: tournamentId },
        data: { status: 'active' },
      });

      // 3. Simple Pairing Logic (berdasarkan ELO)
      players.sort((a, b) => (b.elo || 0) - (a.elo || 0));

      const pairings: any[] = [];
      for (let i = 0; i < players.length - 1; i += 2) {
        pairings.push([players[i], players[i + 1]]);
      }

      const createdGames = [];
      // 4. Buat Games untuk setiap pasangan
      for (let i = 0; i < pairings.length; i++) {
        const [p1, p2] = pairings[i];

        const timeControl =
          typeof tournament.time_control === 'string'
            ? JSON.parse(tournament.time_control)
            : tournament.time_control;

        const newGame = await tx.game.create({
          data: {
            white_id: p1.id,
            black_id: p2.id,
            time_control: timeControl as any,
            stakes: 0n,
            white_elo_before: p1.elo,
            black_elo_before: p2.elo,
            white_time_left: (timeControl as any).initial,
            black_time_left: (timeControl as any).initial,
            status: 'active',
          },
        });

        await tx.tournamentGame.create({
          data: {
            tournament_id: tournamentId,
            game_id: newGame.id,
            round: 1,
            board: i + 1,
          },
        });

        createdGames.push({ gameId: newGame.id, p1: p1.id, p2: p2.id });
      }

      return { success: true, createdGames };
    });

    if (result.success && result.createdGames) {
      for (const match of result.createdGames) {
        if (io) {
          io.to(match.p1).emit('tournament:match_found', { gameId: match.gameId, tournamentId });
          io.to(match.p2).emit('tournament:match_found', { gameId: match.gameId, tournamentId });
        }
      }
      console.log(
        `[Tournament] ${tournamentId} started with ${result.createdGames.length} matches.`,
      );
    }
  } catch (err: any) {
    console.error(`[Tournament] Error starting ${tournamentId}:`, err.message);
  }
}

export async function processTournamentStep(tournamentId: string, io: Server) {
  try {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { registrations: true },
    });

    if (!tournament || tournament.status !== 'active') return;

    // 1. Cek apakah ronde saat ini sudah selesai
    const activeGames = await prisma.tournamentGame.count({
      where: {
        tournament_id: tournamentId,
        game: { status: 'active' },
      },
    });

    if (activeGames > 0) return; // Masih ada game yang jalan

    // 2. Ambil info ronde terakhir
    const lastGame = await prisma.tournamentGame.findFirst({
      where: { tournament_id: tournamentId },
      orderBy: { round: 'desc' },
    });

    const currentRound = lastGame ? lastGame.round || 1 : 1;
    const maxRounds = 3; // Contoh: Turnamen 3 ronde

    if (currentRound >= maxRounds) {
      // 3. SELESAIKAN TURNAMEN
      const winnerRecord = await prisma.tournamentRegistration.findFirst({
        where: { tournament_id: tournamentId },
        orderBy: { score: 'desc' },
        include: { user: true },
      });

      await prisma.tournament.update({
        where: { id: tournamentId },
        data: {
          status: 'finished',
          winner_id: winnerRecord?.user_id,
          ends_at: new Date(),
        },
      });

      if (winnerRecord?.user_id && io) {
        io.emit('tournament:finished', {
          tournamentId,
          winner: winnerRecord.user.username,
          prize: tournament.prize_pool?.toString(),
        });
      }
      console.log(`[Tournament] ${tournamentId} finished. Winner: ${winnerRecord?.user.username}`);
      return;
    }

    // 4. MULAI RONDE BERIKUTNYA
    const nextRound = currentRound + 1;
    const players = await prisma.tournamentRegistration.findMany({
      where: { tournament_id: tournamentId },
      include: { user: { select: { id: true, username: true, elo: true } } },
      orderBy: { score: 'desc' },
    });

    // Simple Swiss-ish pairing: pasangkan yang skornya mirip
    const pairings = [];
    const playerUsers = players.map((p) => p.user);
    for (let i = 0; i < playerUsers.length - 1; i += 2) {
      pairings.push([playerUsers[i], playerUsers[i + 1]]);
    }

    console.log(`[Tournament] ${tournamentId} starting Round ${nextRound}...`);

    for (let i = 0; i < pairings.length; i++) {
      const [p1, p2] = pairings[i];
      const timeControl =
        typeof tournament.time_control === 'string'
          ? JSON.parse(tournament.time_control)
          : tournament.time_control;

      const newGame = await prisma.game.create({
        data: {
          white_id: p1.id,
          black_id: p2.id,
          time_control: timeControl as any,
          stakes: 0n,
          white_elo_before: p1.elo,
          black_elo_before: p2.elo,
          status: 'active',
        },
      });

      await prisma.tournamentGame.create({
        data: {
          tournament_id: tournamentId,
          game_id: newGame.id,
          round: nextRound,
          board: i + 1,
        },
      });

      if (io) {
        io.to(p1.id).emit('tournament:match_found', {
          gameId: newGame.id,
          tournamentId,
          round: nextRound,
        });
        io.to(p2.id).emit('tournament:match_found', {
          gameId: newGame.id,
          tournamentId,
          round: nextRound,
        });
      }
    }
  } catch (err: any) {
    console.error(`[Tournament] Step Error ${tournamentId}:`, err.message);
  }
}

export async function runTournamentMonitor(io: Server) {
  try {
    // Cek koneksi DB dulu (Pencegahan banjir error)
    const alive = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
    if (!alive) return;

    // 1. Mulai turnamen yang baru (upcoming -> active)
    const upcoming = await prisma.tournament.findMany({
      where: { status: 'upcoming', starts_at: { lte: new Date() } },
      select: { id: true },
    });
    for (const t of upcoming) await startTournament(t.id, io);

    // 2. Proses turnamen yang aktif (lanjut ronde / selesai)
    const active = await prisma.tournament.findMany({
      where: { status: 'active' },
      select: { id: true },
    });
    for (const t of active) await processTournamentStep(t.id, io);
  } catch (err: any) {
    logger.error(`[Tournament Monitor] Error: ${err.message}`);
  }
}

let monitorInterval: NodeJS.Timeout | null = null;

export function startTournamentMonitor(io: Server) {
  if (monitorInterval) return;
  console.log('[Tournament Monitor] Started (check every 30s)');
  monitorInterval = setInterval(() => runTournamentMonitor(io), 30000);
}
