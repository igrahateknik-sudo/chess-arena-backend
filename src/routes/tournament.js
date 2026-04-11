const express = require('express');
const router = express.Router();
const { tournaments, wallets, transactions, notifications, query } = require('../lib/db');
const { requireAuth } = require('../middleware/auth');

// ── GET /api/tournament ───────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const validStatuses = ['upcoming', 'active', 'finished'];

    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status filter' });
    }

    const list = await tournaments.list(status);
    res.json({ tournaments: list });
  } catch (err) {
    console.error('[tournament/list]', err);
    res.status(500).json({ error: 'Failed to fetch tournaments' });
  }
});

// ── POST /api/tournament/:id/register (Ticket Purchase Logic) ────────────────
router.post('/:id/register', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.userId;
  const user = req.user;

  try {
    // 1. Cek turnamen dengan LOCK untuk mencegah race condition (traffic tinggi)
    const tRes = await query('SELECT * FROM tournaments WHERE id = $1 FOR SHARE', [id]);
    const tournament = tRes.rows[0];

    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    if (tournament.status !== 'upcoming') return res.status(400).json({ error: 'Registration closed' });

    // 2. Cek ELO
    if ((tournament.min_elo && user.elo < tournament.min_elo) || 
        (tournament.max_elo && user.elo > tournament.max_elo)) {
      return res.status(403).json({ error: 'ELO eligibility failed' });
    }

    // 3. Cek pendaftaran ganda & slot tersedia
    const regCount = await tournaments.getRegistrationCount(id);
    if (tournament.max_players && regCount >= tournament.max_players) {
      return res.status(409).json({ error: 'Tournament is full' });
    }

    const existing = await tournaments.findRegistration(id, userId);
    if (existing) return res.status(409).json({ error: 'Already registered' });

    // 4. ATOMIC PURCHASE (Menggunakan Postgres Transaction)
    await query('BEGIN');
    try {
      if (tournament.entry_fee > 0) {
        // Cek saldo & debit
        const walletRes = await query('SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
        const balance = parseInt(walletRes.rows[0]?.balance || 0);

        if (balance < tournament.entry_fee) {
          throw new Error('INSUFFICIENT_BALANCE');
        }

        await query('UPDATE wallets SET balance = balance - $1 WHERE user_id = $2', [tournament.entry_fee, userId]);
        await transactions.create({
          user_id: userId,
          type: 'tournament_entry',
          amount: -tournament.entry_fee,
          status: 'completed',
          description: `Ticket for: ${tournament.name}`,
          metadata: JSON.stringify({ tournament_id: id })
        });
      }

      const registration = await tournaments.registerPlayer({
        tournament_id: id,
        user_id: userId,
        paid: tournament.entry_fee > 0,
        score: 0
      });

      await query('COMMIT');

      // Notif sukses
      await notifications.create(userId, 'tournament_registered', 'Tiket Turnamen Diterima', 
        `Anda terdaftar di "${tournament.name}". Silakan standby saat turnamen dimulai.`);

      res.status(201).json({ message: 'Registration successful', registration });
    } catch (txErr) {
      await query('ROLLBACK');
      if (txErr.message === 'INSUFFICIENT_BALANCE') {
        return res.status(402).json({ error: 'Saldo tidak mencukupi untuk membeli tiket' });
      }
      throw txErr;
    }
  } catch (err) {
    console.error('[tournament/register]', err);
    res.status(500).json({ error: 'System busy, try again later' });
  }
});

// ── GET /api/tournament/:id/players ──────────────────────────────────────────
router.get('/:id/players', async (req, res) => {
  try {
    const players = await tournaments.getPlayers(req.params.id);
    res.json({ players });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch players' });
  }
});

module.exports = router;
