import express, { Response } from 'express';
import prisma from '../lib/prisma';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { tournaments, notifications } from '../lib/db';

const router = express.Router();

// ── GET /api/tournament ──────────────────────────────────────────────────────
router.get('/', async (_req: express.Request, res: Response) => {
  try {
    const list = await prisma.tournament.findMany({
      where: { status: { in: ['upcoming', 'active'] } },
      orderBy: { starts_at: 'asc' },
    });
    res.json({ tournaments: list });
  } catch (_err) {
    res.status(500).json({ error: 'Failed to fetch tournaments' });
  }
});

// ── GET /api/tournament/:id ──────────────────────────────────────────────────
router.get('/:id', async (req: express.Request, res: Response) => {
  try {
    const item = await prisma.tournament.findUnique({
      where: { id: req.params.id as string },
    });
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json({ tournament: item });
  } catch (_err) {
    res.status(500).json({ error: 'Failed to fetch tournament' });
  }
});

// ── POST /api/tournament/:id/register ────────────────────────────────────────
router.post('/:id/register', requireAuth, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const userId = req.userId!;
  const user = req.user!;

  try {
    // 1. Cek turnamen
    const tournament = await prisma.tournament.findUnique({
      where: { id: id as string },
    });

    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    if (tournament.status !== 'upcoming')
      return res.status(400).json({ error: 'Registration closed' });

    // 2. Cek ELO
    if (
      (tournament.min_elo && user.elo && user.elo < tournament.min_elo) ||
      (tournament.max_elo && user.elo && user.elo > tournament.max_elo)
    ) {
      return res.status(403).json({ error: 'ELO eligibility failed' });
    }

    // 3. Cek pendaftaran ganda & slot tersedia
    const regCount = await tournaments.getRegistrationCount(id as string);
    if (tournament.max_players && regCount >= tournament.max_players) {
      return res.status(409).json({ error: 'Tournament is full' });
    }

    const existing = await tournaments.findRegistration(id as string, userId);
    if (existing) return res.status(409).json({ error: 'Already registered' });

    // 4. ATOMIC PURCHASE (Menggunakan Prisma Transaction)
    try {
      await prisma.$transaction(async (tx) => {
        if (tournament.entry_fee && tournament.entry_fee > 0n) {
          // Cek saldo & debit
          const wallet = await tx.wallet.findUnique({
            where: { user_id: userId },
          });
          const balance = wallet?.balance || 0n;

          if (balance < tournament.entry_fee) {
            throw new Error('INSUFFICIENT_BALANCE');
          }

          await tx.wallet.update({
            where: { user_id: userId },
            data: { balance: { decrement: tournament.entry_fee } },
          });

          await tx.transaction.create({
            data: {
              user_id: userId,
              type: 'tournament_entry',
              amount: -tournament.entry_fee,
              status: 'completed',
              description: `Ticket for: ${tournament.name}`,
              tournament_id: id as string,
            },
          });
        }

        await tx.tournamentRegistration.create({
          data: {
            tournament_id: id as string,
            user_id: userId,
            paid: (tournament.entry_fee || 0n) > 0n,
            score: 0,
          },
        });
      });

      // Notif sukses
      await notifications.create(
        userId,
        'tournament_registered',
        'Tiket Turnamen Diterima',
        `Anda terdaftar di "${tournament.name}". Silakan standby saat turnamen dimulai.`,
      );

      res.status(201).json({ message: 'Registration successful' });
    } catch (txErr: any) {
      if (txErr.message === 'INSUFFICIENT_BALANCE') {
        return res.status(402).json({ error: 'Saldo tidak mencukupi untuk membeli tiket' });
      }
      throw txErr;
    }
  } catch (_err) {
    console.error('[tournament/register]', _err);
    res.status(500).json({ error: 'System busy, try again later' });
  }
});

// ── GET /api/tournament/:id/players ──────────────────────────────────────────
router.get('/:id/players', async (req: express.Request, res: Response) => {
  try {
    const players = await tournaments.getPlayers(req.params.id as string);
    res.json({ players });
  } catch (_err) {
    res.status(500).json({ error: 'Failed to fetch players' });
  }
});

export default router;
