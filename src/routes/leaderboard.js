const express = require('express');
const router = express.Router();
const { users } = require('../lib/db');

router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const data = await users.getLeaderboard(limit);

    const leaderboard = data.map((u, i) => ({
      rank: i + 1,
      id: u.id,
      username: u.username,
      avatar_url: u.avatar_url,
      elo: u.elo,
      title: u.title,
      country: u.country || 'ID',
      wins: u.wins,
      losses: u.losses,
      draws: u.draws,
      games_played: u.games_played,
      winRate: u.games_played > 0 ? Math.round((u.wins / u.games_played) * 100) : 0,
    }));

    res.json({ leaderboard });
  } catch (err) {
    console.error('[leaderboard]', err);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

module.exports = router;
