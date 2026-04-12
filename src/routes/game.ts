import express, { Response, Request } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { games, eloHistory } from '../lib/db';
import validate from '../middleware/validate';
import { gameListSchema } from '../lib/validators';

const router = express.Router();

// ── GET /api/game/:gameId ────────────────────────────────────────────────────
router.get('/:gameId', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const game = await games.findById(req.params.gameId);
    if (!game) return res.status(404).json({ error: 'Game not found' });

    if (game.white_id !== req.userId && game.black_id !== req.userId) {
      return res.status(403).json({ error: 'Not a player in this game' });
    }

    res.json({ game });
  } catch (err) {
    console.error('[game/:gameId]', err);
    res.status(500).json({ error: 'Failed to fetch game' });
  }
});

// ── GET /api/game/history/:userId ────────────────────────────────────────────
router.get('/history/:userId', requireAuth, validate(gameListSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { limit } = req.body;
    const history = await games.getHistory(req.params.userId, limit);
    res.json({ history });
  } catch (err) {
    console.error('[game/history/:userId]', err);
    res.status(500).json({ error: 'Failed to fetch game history' });
  }
});

// ── GET /api/game/elo/:userId ────────────────────────────────────────────────
router.get('/elo/:userId', validate(gameListSchema), async (req: Request, res: Response) => {
  try {
    const { limit } = req.body;
    const history = await eloHistory.getForUser(req.params.userId, limit);
    res.json({ history });
  } catch (err) {
    console.error('[game/elo/:userId]', err);
    res.status(500).json({ error: 'Failed to fetch ELO history' });
  }
});

export default router;
