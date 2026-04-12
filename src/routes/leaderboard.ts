import express, { Request, Response } from 'express';
import { users } from '../lib/db';

const router = express.Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const data = await users.getLeaderboard(limit);

    const leaderboard = data.map((u, i) => ({
      rank: i + 1,
      id: u.id,
      username: u.username,
      avatar_url: u.avatar_url,
      elo: u.elo,
      title: u.title,
      country: u.country || 'ID',
      wins: u.wins || 0,
      losses: u.losses || 0,
      draws: u.draws || 0,
      games_played: u.games_played || 0,
      winRate:
        (u.games_played || 0) > 0 ? Math.round(((u.wins || 0) / (u.games_played || 0)) * 100) : 0,
    }));

    res.json({ leaderboard });
  } catch (err) {
    console.error('[leaderboard]', err);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

export default router;
