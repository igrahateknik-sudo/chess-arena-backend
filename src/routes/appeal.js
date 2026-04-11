/**
 * Appeal Process API — User-facing
 */

const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middleware/auth');
const { users, appeals } = require('../lib/db');

// ── POST /api/appeal ──────────────────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  try {
    const { reason, evidence } = req.body;
    const userId = req.userId;

    if (!reason || reason.trim().length < 20) {
      return res.status(400).json({ error: 'Reason must be at least 20 characters' });
    }
    if (reason.length > 2000) {
      return res.status(400).json({ error: 'Reason too long (max 2000 chars)' });
    }

    const user = await users.findById(userId);
    if (!user?.flagged) {
      return res.status(400).json({ error: 'No active flag on your account to appeal' });
    }

    const existing = await appeals.findPendingByUser(userId);
    if (existing) {
      return res.status(409).json({
        error: 'You already have a pending appeal',
        appealId: existing.id,
      });
    }

    const count = await appeals.countByUser(userId);
    if (count >= 3) {
      return res.status(429).json({ error: 'Maximum appeal limit reached (3). Contact support directly.' });
    }

    const appeal = await appeals.create({
      user_id:        userId,
      reason:         reason.trim(),
      evidence:       evidence?.trim() || null,
      status:         'pending',
      flag_reason_at: user.flagged_reason,
      trust_at:       user.trust_score,
    });

    console.info(`[Appeal] User ${userId} submitted appeal ${appeal.id}`);

    res.status(201).json({
      appeal: {
        id:         appeal.id,
        status:     appeal.status,
        created_at: appeal.created_at,
      },
      message: 'Appeal submitted. Our team will review it within 48 hours.',
    });
  } catch (err) {
    console.error('[appeal/submit]', err);
    res.status(500).json({ error: 'Failed to submit appeal' });
  }
});

// ── GET /api/appeal/mine ──────────────────────────────────────────────────
router.get('/mine', requireAuth, async (req, res) => {
  try {
    const list = await appeals.findByUser(req.userId);
    const user = await users.findById(req.userId);

    res.json({
      appeals: list || [],
      account: {
        flagged:       user?.flagged       || false,
        flaggedReason: user?.flagged_reason|| null,
        trustScore:    user?.trust_score   ?? 100,
      },
    });
  } catch (err) {
    console.error('[appeal/mine]', err);
    res.status(500).json({ error: 'Failed to load appeals' });
  }
});

module.exports = router;
