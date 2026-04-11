const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { users } = require('../lib/db');
const { signToken, verifyToken } = require('../lib/auth');
const { requireAuth } = require('../middleware/auth');

// ── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields required' });
    }
    if (username.length < 3 || username.length > 30) {
      return res.status(400).json({ error: 'Username must be 3-30 characters' });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ error: 'Username can only contain letters, numbers, underscores' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await users.findByUsername(username);
    if (existing) return res.status(409).json({ error: 'Username already taken' });

    const existingEmail = await users.findByEmail(email);
    if (existingEmail) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await users.create({ username, email, passwordHash });

    const token = signToken({ userId: user.id });
    res.status(201).json({ token, user: users.public(user) });
  } catch (err) {
    console.error('[auth/register]', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, username, password } = req.body;

    let user;
    if (email) {
      user = await users.findByEmail(email);
    } else if (username) {
      user = await users.findByUsername(username);
    } else {
      return res.status(400).json({ error: 'Email or username required' });
    }

    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken({ userId: user.id });
    res.json({ token, user: users.public(user) });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── POST /api/auth/guest ─────────────────────────────────────────────────────
router.post('/guest', async (req, res) => {
  try {
    const id = Math.floor(Math.random() * 99999).toString().padStart(5, '0');
    const username = `Guest${id}`;
    const passwordHash = await bcrypt.hash(Math.random().toString(36), 8);

    const user = await users.create({
      username,
      email: `${username.toLowerCase()}@guest.chess-arena.app`,
      passwordHash,
    });

    const token = signToken({ userId: user.id });
    res.status(201).json({ token, user: users.public(user) });
  } catch (err) {
    console.error('[auth/guest]', err);
    res.status(500).json({ error: 'Guest login failed' });
  }
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: users.public(req.user) });
});

// ── PATCH /api/auth/profile ──────────────────────────────────────────────────
router.patch('/profile', requireAuth, async (req, res) => {
  try {
    const { country, avatar_url } = req.body;
    const updates = {};
    if (country) updates.country = country;
    if (avatar_url) updates.avatar_url = avatar_url;

    const updated = await users.update(req.userId, updates);
    res.json({ user: users.public(updated) });
  } catch (err) {
    console.error('[auth/profile]', err);
    res.status(500).json({ error: 'Profile update failed' });
  }
});

// ── POST /api/auth/change-password ───────────────────────────────────────────
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Both passwords required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const match = await bcrypt.compare(currentPassword, req.user.password_hash);
    if (!match) return res.status(401).json({ error: 'Current password incorrect' });

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await users.update(req.userId, { password_hash: passwordHash });

    res.json({ ok: true });
  } catch (err) {
    console.error('[auth/change-password]', err);
    res.status(500).json({ error: 'Password change failed' });
  }
});

const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ── POST /api/auth/google/callback ──────────────────────────────────────────
router.post('/google/callback', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'ID Token required' });

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    let user = await users.findByEmail(email);
    if (!user) {
      // Buat user baru jika belum ada
      const username = name.replace(/\s+/g, '_').toLowerCase() + Math.floor(Math.random() * 1000);
      const passwordHash = await bcrypt.hash(Math.random().toString(36), 12);
      user = await users.create({
        username,
        email,
        passwordHash,
        avatar_url: picture,
      });
    }

    const token = signToken({ userId: user.id });
    res.json({ token, user: users.public(user) });
  } catch (err) {
    console.error('[auth/google]', err);
    res.status(401).json({ error: 'Google authentication failed' });
  }
});

module.exports = router;
