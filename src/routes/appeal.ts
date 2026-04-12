import express, { Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { users, appeals } from '../lib/db';

const router = express.Router();

// ── POST /api/appeal ─────────────────────────────────────────────────────────
router.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { reason, evidence } = req.body;
    const userId = req.userId!;

    if (!reason) return res.status(400).json({ error: 'Reason is required' });

    // Check if user is actually flagged
    const user = await users.findById(userId);
    if (!user?.flagged) {
      return res.status(400).json({ error: 'You are not flagged' });
    }

    // Check if already has a pending appeal
    const existing = await appeals.findPendingByUser(userId);
    if (existing) {
      return res.status(400).json({ error: 'You already have a pending appeal' });
    }

    const appeal = await appeals.create({
      user_id: userId,
      reason,
      evidence,
      trust_at: user.trust_score || 100,
    });

    res.status(201).json({ appeal });
  } catch (_err) {
    console.error('[appeal/create]', _err);
    res.status(500).json({ error: 'Failed to submit appeal' });
  }
});

// ── GET /api/appeal/my ───────────────────────────────────────────────────────
router.get('/my', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const list = await appeals.findByUser(req.userId!);
    res.json({ appeals: list });
  } catch (_err) {
    res.status(500).json({ error: 'Failed to fetch appeals' });
  }
});

export default router;
