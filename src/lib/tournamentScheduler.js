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

const { query, games } = require('./db');

async function startTournament(tournamentId, io) {
  console.log(`[Tournament] Starting tournament ${tournamentId}...`);

  try {
    await query('BEGIN');

    // 1. Ambil data turnamen & pemain
    const tRes = await query('SELECT * FROM tournaments WHERE id = $1 FOR UPDATE', [tournamentId]);
    const tournament = tRes.rows[0];

    if (!tournament || tournament.status !== 'upcoming') {
      await query('ROLLBACK');
      return;
    }

    const pRes = await query(`
      SELECT user_id, u.username, u.elo 
      FROM tournament_registrations tr
      JOIN users u ON tr.user_id = u.id
      WHERE tournament_id = $1
    `, [tournamentId]);
    
    const players = pRes.rows;

    if (players.length < 2) {
      console.warn(`[Tournament] Not enough players for ${tournamentId}, cancelling.`);
      await query("UPDATE tournaments SET status = 'cancelled' WHERE id = $1", [tournamentId]);
      await query('COMMIT');
      return;
    }

    // 2. Set status jadi ACTIVE
    await query("UPDATE tournaments SET status = 'active' WHERE id = $1", [tournamentId]);

    // 3. Simple Pairing Logic (berdasarkan ELO)
    // Urutkan berdasarkan ELO untuk pairing yang seimbang
    players.sort((a, b) => b.elo - a.elo);

    const pairings = [];
    for (let i = 0; i < players.length - 1; i += 2) {
      pairings.push([players[i], players[i+1]]);
    }

    // 4. Buat Games untuk setiap pasangan
    for (let i = 0; i < pairings.length; i++) {
      const [p1, p2] = pairings[i];
      
      const newGame = await games.create({
        white_id: p1.user_id,
        black_id: p2.user_id,
        time_control: tournament.time_control,
        stakes: 0, // Turnamen biasanya hadiah di akhir, bukan stake per game
        white_elo_before: p1.elo,
        black_elo_before: p2.elo,
        white_time_left: JSON.parse(tournament.time_control).initial,
        black_time_left: JSON.parse(tournament.time_control).initial,
      });

      await query(`
        INSERT INTO tournament_games (tournament_id, game_id, round, board)
        VALUES ($1, $2, $3, $4)
      `, [tournamentId, newGame.id, 1, i + 1]);

      // 5. Emit ke socket agar pemain otomatis diarahkan ke game
      if (io) {
        io.to(p1.user_id).emit('tournament:match_found', { gameId: newGame.id, tournamentId });
        io.to(p2.user_id).emit('tournament:match_found', { gameId: newGame.id, tournamentId });
      }
    }

    await query('COMMIT');
    console.log(`[Tournament] ${tournamentId} started with ${pairings.length} matches.`);

  } catch (err) {
    await query('ROLLBACK');
    console.error(`[Tournament] Error starting ${tournamentId}:`, err);
  }
}

async function runTournamentMonitor(io) {
  try {
    // Cari turnamen yang harusnya mulai tapi masih 'upcoming'
    const res = await query(`
      SELECT id FROM tournaments 
      WHERE status = 'upcoming' AND starts_at <= NOW()
    `);

    for (const row of res.rows) {
      await startTournament(row.id, io);
    }
  } catch (err) {
    console.error('[Tournament Monitor] Error:', err.message);
  }
}

let monitorInterval = null;

function startTournamentMonitor(io) {
  if (monitorInterval) return;
  console.log('[Tournament Monitor] Started (check every 30s)');
  monitorInterval = setInterval(() => runTournamentMonitor(io), 30000);
}

module.exports = { startTournamentMonitor };
