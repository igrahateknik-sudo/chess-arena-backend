import express, { Response } from 'express';
import { requireAdmin } from '../middleware/adminAuth';
import { 
  users, 
  antiCheatActions, 
  collusionFlags, 
  multiAccountFlags, 
  appeals 
} from '../lib/db';
import { logAnticheatAction } from '../lib/auditLog';
import { checkQueueHealth } from '../lib/monitor';
import { AuthRequest } from '../middleware/auth';
import validate from '../middleware/validate';
import { 
  adminListSchema, 
  adminReviewUserSchema, 
  adminReviewFlagSchema, 
  adminReviewAppealSchema 
} from '../lib/validators';

const router = express.Router();

// Semua rute ini memerlukan hak admin
router.use(requireAdmin);

// ── GET /api/admin/stats ─────────────────────────────────────────────────
router.get('/stats', async (_req: AuthRequest, res: Response) => {
  try {
    const stats = await users.getAdminStats();
    res.json(stats);
  } catch (err) {
    console.error('[admin/stats]', err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// ── GET /api/admin/users ──────────────────────────────────────────────────
router.get('/users', validate(adminListSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { limit, offset, search } = req.body; // Dari Zod preprocess/parse
    const result = await users.listForAdmin(limit, offset, search);
    res.json(result);
  } catch (err) {
    console.error('[admin/users]', err);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

// ── GET /api/admin/users/:id ──────────────────────────────────────────────
router.get('/users/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userDetail = await users.getDetailForAdmin(id);

    if (!userDetail) return res.status(404).json({ error: 'User not found' });

    const actions = await antiCheatActions.getByUserId(id);

    res.json({ user: userDetail, actions });
  } catch (err) {
    console.error('[admin/users/detail]', err);
    res.status(500).json({ error: 'Failed to load user detail' });
  }
});

// ── POST /api/admin/users/:id/review ─────────────────────────────────────
router.post('/users/:id/review', validate(adminReviewUserSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { action, reason, score, flags } = req.body;

    if (action === 'suspend') {
      await users.update(id, { flagged: true, flagged_at: new Date() });
    }

    // Log the anti-cheat action
    await logAnticheatAction({
      userId: id,
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
router.get('/anticheat-actions', validate(adminListSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { limit, action } = req.body;
    const actions = await antiCheatActions.list(limit, action);
    res.json({ actions });
  } catch (err) {
    console.error('[admin/anticheat-actions]', err);
    res.status(500).json({ error: 'Failed to load actions' });
  }
});

// ── GET /api/admin/collusion-flags ───────────────────────────────────────
router.get('/collusion-flags', async (_req: AuthRequest, res: Response) => {
  try {
    const flags = await collusionFlags.listPending();
    res.json({ flags });
  } catch (err) {
    console.error('[admin/collusion-flags]', err);
    res.status(500).json({ error: 'Failed to load collusion flags' });
  }
});

// ── POST /api/admin/collusion-flags/:id/review ───────────────────────────
router.post('/collusion-flags/:id/review', validate(adminReviewFlagSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { verdict, note } = req.body;

    await collusionFlags.review(id, verdict, note, req.userId!);
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/collusion/review]', err);
    res.status(500).json({ error: 'Review failed' });
  }
});

// ── GET /api/admin/multi-account-flags ───────────────────────────────────
router.get('/multi-account-flags', async (_req: AuthRequest, res: Response) => {
  try {
    const flags = await multiAccountFlags.listPending();
    res.json({ flags });
  } catch (err) {
    console.error('[admin/multi-account-flags]', err);
    res.status(500).json({ error: 'Failed to load multi-account flags' });
  }
});

// ── POST /api/admin/multi-account-flags/:id/review ────────────────────────
router.post('/multi-account-flags/:id/review', validate(adminReviewFlagSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { verdict, note } = req.body;

    await multiAccountFlags.review(id, verdict, note, req.userId!);
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/multi-account/review]', err);
    res.status(500).json({ error: 'Review failed' });
  }
});

// ── GET /api/admin/appeals ────────────────────────────────────────────────
router.get('/appeals', validate(adminListSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.body;
    const list = await appeals.list(status || 'pending');
    res.json({ appeals: list });
  } catch (err) {
    console.error('[admin/appeals]', err);
    res.status(500).json({ error: 'Failed to load appeals' });
  }
});

// ── POST /api/admin/appeals/:id/review ────────────────────────────────────
router.post('/appeals/:id/review', validate(adminReviewAppealSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { verdict, admin_note } = req.body;

    await appeals.review(id, verdict, admin_note, req.userId!);
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
