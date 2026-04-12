import express, { Response } from 'express';
import { requireAdmin } from '../middleware/adminAuth';
import prisma from '../lib/prisma';
import { logAnticheatAction } from '../lib/auditLog';
import { checkQueueHealth } from '../lib/monitor';
import { AuthRequest } from '../middleware/auth';

const router = express.Router();

// Semua rute ini memerlukan hak admin
router.use(requireAdmin);

// ── GET /api/admin/stats ─────────────────────────────────────────────────
router.get('/stats', async (_req: AuthRequest, res: Response) => {
  try {
    const totalUsers = await prisma.user.count();
    const activeGames24h = await prisma.game.count({
      where: {
        started_at: { gte: new Date(Date.now() - 24 * 3600000) },
      },
    });
    const recentSuspends7d = await prisma.antiCheatAction.count({
      where: {
        action: 'suspend',
        created_at: { gte: new Date(Date.now() - 7 * 24 * 3600000) },
      },
    });

    res.json({
      totalUsers,
      activeGames24h,
      recentSuspends7d,
    });
  } catch (err) {
    console.error('[admin/stats]', err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// ── GET /api/admin/users ──────────────────────────────────────────────────
router.get('/users', async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(100, parseInt((req.query.limit as string) || '50'));
    const offset = parseInt((req.query.offset as string) || '0');
    const search = req.query.search as string;

    const usersList = await prisma.user.findMany({
      where: search
        ? {
            OR: [
              { username: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {},
      select: {
        id: true,
        username: true,
        email: true,
        elo: true,
        trust_score: true,
        flagged: true,
        flagged_at: true,
        last_ip: true,
        created_at: true,
      },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset,
    });

    const total = await prisma.user.count({
      where: search
        ? {
            OR: [
              { username: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {},
    });

    res.json({ users: usersList, total });
  } catch (err) {
    console.error('[admin/users]', err);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

// ── GET /api/admin/users/:id ──────────────────────────────────────────────
router.get('/users/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({
      where: { id: id as string },
      include: {
        _count: {
          select: {
            white_games: true,
            black_games: true,
            appeals: true,
          },
        },
      },
    });

    if (!user) return res.status(404).json({ error: 'User not found' });

    const actions = await prisma.antiCheatAction.findMany({
      where: { user_id: id as string },
      orderBy: { created_at: 'desc' },
    });

    res.json({ user, actions });
  } catch (err) {
    console.error('[admin/users/detail]', err);
    res.status(500).json({ error: 'Failed to load user detail' });
  }
});

// ── POST /api/admin/users/:id/review ─────────────────────────────────────
router.post('/users/:id/review', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { action, reason, score, flags } = req.body;

    if (!['warn', 'suspend', 'none'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    if (action === 'suspend') {
      await prisma.user.update({
        where: { id: id as string },
        data: { flagged: true, flagged_at: new Date() },
      });
    }

    // Log the anti-cheat action
    await logAnticheatAction({
      userId: id as string,
      gameId: null,
      action,
      reason,
      score: score || 0,
      flags: flags || [],
    });

    res.json({ ok: true, action, userId: id });
  } catch (err) {
    console.error('[admin/users/review]', err);
    res.status(500).json({ error: 'Review failed' });
  }
});

// ── GET /api/admin/anticheat-actions ─────────────────────────────────────
router.get('/anticheat-actions', async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(100, parseInt((req.query.limit as string) || '50'));
    const action = req.query.action as string;

    const actions = await prisma.antiCheatAction.findMany({
      where: action ? { action } : {},
      include: {
        user: {
          select: {
            id: true,
            username: true,
            elo: true,
            trust_score: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
      take: limit,
    });

    const formattedActions = actions.map((r) => ({
      id: r.id,
      action: r.action,
      reason: r.reason,
      flags: r.flags,
      score: r.score,
      created_at: r.created_at,
      users: r.user,
    }));

    res.json({ actions: formattedActions });
  } catch (err) {
    console.error('[admin/anticheat-actions]', err);
    res.status(500).json({ error: 'Failed to load actions' });
  }
});

// ── GET /api/admin/collusion-flags ───────────────────────────────────────
router.get('/collusion-flags', async (_req: AuthRequest, res: Response) => {
  try {
    const flags = await prisma.collusionFlag.findMany({
      where: { reviewed: false },
      include: {
        user_a: { select: { id: true, username: true, elo: true } },
        user_b: { select: { id: true, username: true, elo: true } },
      },
      orderBy: { detected_at: 'desc' },
      take: 50,
    });

    const formattedFlags = flags.map((r) => ({
      ...r,
      userA: r.user_a,
      userB: r.user_b,
    }));

    res.json({ flags: formattedFlags });
  } catch (err) {
    console.error('[admin/collusion-flags]', err);
    res.status(500).json({ error: 'Failed to load collusion flags' });
  }
});

// ── POST /api/admin/collusion-flags/:id/review ───────────────────────────
router.post('/collusion-flags/:id/review', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { verdict, note } = req.body;

    if (!['confirmed', 'dismissed'].includes(verdict)) {
      return res.status(400).json({ error: 'verdict must be confirmed or dismissed' });
    }

    await prisma.collusionFlag.update({
      where: { id: id as string },
      data: {
        reviewed: true,
        verdict,
        review_note: note,
        reviewed_at: new Date(),
        reviewed_by: req.userId,
      },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/collusion/review]', err);
    res.status(500).json({ error: 'Review failed' });
  }
});

// ── GET /api/admin/multi-account-flags ───────────────────────────────────
router.get('/multi-account-flags', async (_req: AuthRequest, res: Response) => {
  try {
    const flags = await prisma.multiAccountFlag.findMany({
      where: { reviewed: false },
      include: {
        user_a: { select: { id: true, username: true, email: true } },
        user_b: { select: { id: true, username: true, email: true } },
      },
      orderBy: { detected_at: 'desc' },
      take: 50,
    });

    const formattedFlags = flags.map((r) => ({
      ...r,
      userA: r.user_a,
      userB: r.user_b,
    }));

    res.json({ flags: formattedFlags });
  } catch (err) {
    console.error('[admin/multi-account-flags]', err);
    res.status(500).json({ error: 'Failed to load multi-account flags' });
  }
});

// ── POST /api/admin/multi-account-flags/:id/review ────────────────────────
router.post('/multi-account-flags/:id/review', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { verdict, note } = req.body;

    if (!['confirmed', 'dismissed'].includes(verdict)) {
      return res.status(400).json({ error: 'verdict must be confirmed or dismissed' });
    }

    await prisma.multiAccountFlag.update({
      where: { id: id as string },
      data: {
        reviewed: true,
        verdict,
        review_note: note,
        reviewed_at: new Date(),
        reviewed_by: req.userId,
      },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/multi-account/review]', err);
    res.status(500).json({ error: 'Review failed' });
  }
});

// ── GET /api/admin/appeals ────────────────────────────────────────────────
router.get('/appeals', async (req: AuthRequest, res: Response) => {
  try {
    const status = (req.query.status as string) || 'pending';
    const appeals = await prisma.appeal.findMany({
      where: { status: status as any },
      include: {
        user: { select: { id: true, username: true, elo: true, flagged: true } },
      },
      orderBy: { created_at: 'desc' },
    });

    res.json({ appeals });
  } catch (err) {
    console.error('[admin/appeals]', err);
    res.status(500).json({ error: 'Failed to load appeals' });
  }
});

// ── POST /api/admin/appeals/:id/review ────────────────────────────────────
router.post('/appeals/:id/review', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { verdict, admin_note } = req.body;

    if (!['accepted', 'rejected'].includes(verdict)) {
      return res.status(400).json({ error: 'verdict must be accepted or rejected' });
    }

    const appeal = await prisma.appeal.findUnique({ where: { id: id as string } });
    if (!appeal) return res.status(404).json({ error: 'Appeal not found' });

    await prisma.$transaction(async (tx) => {
      await tx.appeal.update({
        where: { id: id as string },
        data: {
          status: verdict as any,
          admin_note,
          reviewed_at: new Date(),
          reviewed_by: req.userId,
        },
      });

      if (verdict === 'accepted') {
        await tx.user.update({
          where: { id: appeal.user_id },
          data: { flagged: false, flagged_at: null },
        });
      }
    });

    res.json({ ok: true, verdict });
  } catch (err) {
    console.error('[admin/appeal/review]', err);
    res.status(500).json({ error: 'Review failed' });
  }
});

// ── GET /api/admin/queue-health ──────────────────────────────────────────
router.get('/queue-health', async (_req: AuthRequest, res: Response) => {
  try {
    const result = await checkQueueHealth();
    res.json(result);
  } catch (err) {
    console.error('[admin/queue-health]', err);
    res.status(500).json({ error: 'Failed to check health' });
  }
});

export default router;
