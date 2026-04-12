import express, { Response } from 'express';
import bcrypt from 'bcryptjs';
import { users } from '../lib/db';
import { signToken } from '../lib/auth';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { OAuth2Client } from 'google-auth-library';
import logger from '../lib/logger';
import { sendVerificationEmail } from '../lib/email';

const router = express.Router();

// ── Google OAuth Client ──────────────────────────────────────────────────────
const getGoogleClient = () => {
  return new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
};

// ── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register', async (req: express.Request, res: Response) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const existing = await users.findByEmail(email);
    if (existing) return res.status(400).json({ error: 'Email already exists' });

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const passwordHash = await bcrypt.hash(password, 10);

    const user = await users.create({
      username,
      email,
      passwordHash: passwordHash,
    });

    // OTOMATIS VERIFIKASI (Solusi tanpa SMTP)
    await users.update(user.id, { 
      verified: true,
      verify_token: null 
    });

    // Coba kirim email di background, tapi jangan tunggu hasilnya
    sendVerificationEmail(email, otp).catch(err => logger.error(`[Email-Silent-Fail] ${err.message}`));

    const token = signToken({ userId: user.id });
    res.status(201).json({
      user: { ...user, verified: true },
      token,
      message: 'Account created and automatically verified!',
    });
  } catch (err: any) {
    logger.error(`[Auth/Register] Error: ${err.message}`);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ── POST /api/auth/verify ────────────────────────────────────────────────────
router.post('/verify', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { code } = req.body;
    const userId = req.userId!;

    if (!code) return res.status(400).json({ error: 'Verification code is required' });

    const user = await users.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.verify_token !== code) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    // Update user as verified
    await users.update(userId, {
      verified: true,
      verify_token: null,
    });

    res.json({ ok: true, message: 'Account verified successfully' });
  } catch (err: any) {
    logger.error(`[Auth/Verify] Error: ${err.message}`);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ── POST /api/auth/resend-otp ────────────────────────────────────────────────
router.post('/resend-otp', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await users.update(user.id, { verify_token: otp });
    const emailSent = await sendVerificationEmail(user.email, otp);

    if (!emailSent) return res.status(500).json({ error: 'Failed to send email' });
    res.json({ ok: true, message: 'New OTP sent to your email' });
  } catch (_err: any) {
    res.status(500).json({ error: 'Failed to resend OTP' });
  }
});

// ── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req: express.Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const user = await users.findByEmail(email);

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signToken({ userId: user.id });
    res.json({ user: users.public(user), token });
  } catch (err: any) {
    logger.error(`[Auth/Login] Error: ${err.message}`);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  res.json({ user: req.user });
});

// ── POST /api/auth/guest ─────────────────────────────────────────────────────
router.post('/guest', async (_req: express.Request, res: Response) => {
  try {
    const guestId = Math.random().toString(36).substring(7);
    const user = await users.create({
      username: `Guest_${guestId}`,
      email: `guest_${guestId}@chess-arena.app`,
      passwordHash: 'GUEST_NO_PWD',
    });

    const token = signToken({ userId: user.id });
    res.json({ user: users.public(user), token });
  } catch (err: any) {
    logger.error(`[Auth/Guest] Error: ${err.message}`);
    res.status(500).json({ error: 'Guest creation failed' });
  }
});

// ── POST /api/auth/google ────────────────────────────────────────────────────
router.post('/google', async (req: express.Request, res: Response) => {
  try {
    const token = req.body.token || req.body.credential || req.body.idToken || req.body.id_token;

    if (!token) {
      logger.warn('[Auth/Google] Login attempt without token');
      return res.status(400).json({ error: 'Google token is required' });
    }

    const client = getGoogleClient();
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload) {
      logger.warn('[Auth/Google] Invalid token payload');
      return res.status(400).json({ error: 'Invalid Google token' });
    }

    const { email, name, picture } = payload;
    let user = await users.findByEmail(email!);

    if (!user) {
      user = await users.create({
        username:
          (name || 'user').replace(/\s/g, '_').toLowerCase() + Math.floor(Math.random() * 1000),
        email: email!,
        passwordHash: 'GOOGLE_AUTH',
        avatarUrl: picture || undefined,
      });
      // Google user otomatis terverifikasi
      await users.update(user.id, { verified: true });
      logger.info(`[Auth/Google] New user created: ${user.username}`);
    } else {
      logger.info(`[Auth/Google] User logged in: ${user.username}`);
    }

    const sessionToken = signToken({ userId: user.id });
    res.json({ user: users.public(user), token: sessionToken });
  } catch (err: any) {
    logger.error(`[Auth/Google] CRITICAL ERROR: ${err.message}`);
    res.status(500).json({
      error: 'Google login failed',
      detail: err.message,
    });
  }
});

export default router;
