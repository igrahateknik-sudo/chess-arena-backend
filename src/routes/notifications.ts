import express, { Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { notifications } from '../lib/db';

const router = express.Router();

// ── GET /api/notifications ───────────────────────────────────────────────────
router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    // Menggunakan getUnread sesuai definisi di src/lib/db.ts
    const list = await notifications.getUnread(req.userId!);
    res.json({ notifications: list });
  } catch (_err) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// ── POST /api/notifications/read-all ──────────────────────────────────────────
router.post('/read-all', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await notifications.markAllRead(req.userId!);
    res.json({ ok: true });
  } catch (_err) {
    res.status(500).json({ error: 'Failed to mark notifications' });
  }
});

export default router;
