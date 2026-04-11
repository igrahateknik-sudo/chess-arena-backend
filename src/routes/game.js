const express = require('express');
const router = express.Router();
const { games, eloHistory } = require('../lib/db');
const { requireAuth } = require('../middleware/auth');

// ── GET /api/game/:gameId ────────────────────────────────────────────────────
router.get('/:gameId', requireAuth, async (req, res) => {
  try {
    const game = await games.findById(req.params.gameId);
    if (!game) return res.status(404).json({ error: 'Game not found' });

    if (game.white_id !== req.userId && game.black_id !== req.userId) {
      return res.status(403).json({ error: 'Not a player in this game' });
    }
    res.json({ game });
  } catch (err) {
    console.error('[game/get]', err);
    res.status(500).json({ error: 'Failed to fetch game' });
  }
});

// ── GET /api/game/history/me ─────────────────────────────────────────────────
router.get('/history/me', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const history = await games.getHistory(req.userId, limit);
    res.json({ history });
  } catch (err) {
    console.error('[game/history/me]', err);
    res.status(500).json({ error: 'Failed to fetch game history' });
  }
});

// ── GET /api/game/history/:userId ────────────────────────────────────────────
router.get('/history/:userId', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const history = await games.getHistory(req.params.userId, limit);
    res.json({ history });
  } catch (err) {
    console.error('[game/history/:userId]', err);
    res.status(500).json({ error: 'Failed to fetch game history' });
  }
});

// ── GET /api/game/elo-history/me ─────────────────────────────────────────────
router.get('/elo-history/me', requireAuth, async (req, res) => {
  try {
    const history = await eloHistory.getForUser(req.userId, 30);
    res.json({ history });
  } catch (err) {
    console.error('[game/elo-history]', err);
    res.status(500).json({ error: 'Failed to fetch ELO history' });
  }
});

module.exports = router;
