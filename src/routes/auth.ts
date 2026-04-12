import express, { Response } from 'express';
import bcrypt from 'bcryptjs';
import { users } from '../lib/db';
import { signToken } from '../lib/auth';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { OAuth2Client } from 'google-auth-library';
import logger from '../lib/logger';
import { sendVerificationEmail, sendResetPasswordEmail } from '../lib/email';
import crypto from 'crypto';
import prisma from '../lib/prisma';

const router = express.Router();

// ── Google OAuth Client ──────────────────────────────────────────────────────
const getGoogleClient = () => {
  return new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
};

// ── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register', async (req: express.Request, res: Response) => {
  logger.info(`[Auth/Register] Attempt for email: ${req.body.email}`);
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const existing = await users.findByEmail(email);
    if (existing) {
      logger.warn(`[Auth/Register] Email already exists: ${email}`);
      return res.status(400).json({ error: 'Email already exists' });
    }

    // Token acak (digunakan untuk link DAN kode)
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const passwordHash = await bcrypt.hash(password, 10);

    const user = await users.create({
      username,
      email,
      passwordHash: passwordHash,
    });
    logger.info(`[Auth/Register] User created in DB: ${user.id}`);

    await users.update(user.id, { verify_token: verificationToken });
    logger.info(`[Auth/Register] Token stored for user: ${user.id}`);

    // Kirim Email (Link + Kode)
    const emailSent = await sendVerificationEmail(email, verificationToken);

    const token = signToken({ userId: user.id });
    
    res.status(201).json({
      user: users.public(user),
      token,
      message: emailSent ? 'Verification email sent' : 'Account created, but verification email failed to send.',
    });
  } catch (err: any) {
    logger.error(`[Auth/Register] CRITICAL ERROR: ${err.message}`);
    res.status(500).json({ error: 'Registration failed internal server error' });
  }
});

// ── GET /api/auth/verify-link (Verifikasi lewat Klik Link) ──────────────────
router.get('/verify-link', async (req: express.Request, res: Response) => {
  try {
    const { token } = req.query;
    if (!token || typeof token !== 'string') {
      return res.status(400).send('<h1>Link Verifikasi Tidak Valid</h1>');
    }

    const user = await prisma.user.findFirst({
      where: { verify_token: token }
    });

    if (!user) {
      return res.status(400).send('<h1>Link Verifikasi Kadaluarsa atau Tidak Valid</h1>');
    }

    await users.update(user.id, {
      verified: true,
      verify_token: null,
    });

    // Redirect ke frontend (dashboard)
    const frontendUrl = process.env.APP_URL?.replace('/api/auth', '') || 'http://localhost:3000';
    res.send(`
      <div style="font-family: sans-serif; text-align: center; padding: 50px;">
        <h1 style="color: #2563eb;">Email Berhasil Diverifikasi!</h1>
        <p>Akun kamu sudah aktif. Kamu akan diarahkan kembali ke aplikasi...</p>
        <script>setTimeout(() => { window.location.href = "${frontendUrl}"; }, 3000);</script>
      </div>
    `);
  } catch (err: any) {
    logger.error(`[Auth/VerifyLink] Error: ${err.message}`);
    res.status(500).send('Internal Server Error');
  }
});

// ── POST /api/auth/verify (Verifikasi lewat Input Kode) ────────────────────
router.post('/verify', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { code } = req.body;
    const userId = req.userId!;

    if (!code) return res.status(400).json({ error: 'Verification code is required' });

    const user = await users.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Cek apakah 6 karakter pertama token cocok dengan kode yang diinput
    if (user.verify_token && user.verify_token.substring(0, 6).toUpperCase() === code.toUpperCase()) {
      await users.update(userId, {
        verified: true,
        verify_token: null,
      });
      return res.json({ ok: true, message: 'Account verified successfully' });
    }

    return res.status(400).json({ error: 'Invalid verification code' });
  } catch (err: any) {
    logger.error(`[Auth/Verify] Error: ${err.message}`);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ── POST /api/auth/verify-email (Lama - untuk kompatibilitas frontend) ──────
router.post('/verify-email', async (req: express.Request, res: Response) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token is required' });

    const user = await prisma.user.findFirst({
      where: { verify_token: token }
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired verification token' });
    }

    await users.update(user.id, {
      verified: true,
      verify_token: null,
    });

    res.json({ ok: true, message: 'Email verified successfully' });
  } catch (err: any) {
    logger.error(`[Auth/VerifyEmail] Error: ${err.message}`);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ── POST /api/auth/resend-verification ──────────────────────────────────────
router.post('/resend-verification', async (req: express.Request, res: Response) => {
  try {
    const { email } = req.body;
    logger.info(`[Auth/ResendVerif] Request for: ${email}`);
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await users.findByEmail(email);
    if (!user) {
      return res.json({ ok: true, message: 'If the email exists, a new link has been sent.' });
    }

    if (user.verified) {
      return res.status(400).json({ error: 'Email already verified' });
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    await users.update(user.id, { verify_token: verificationToken });
    
    const emailSent = await sendVerificationEmail(user.email, verificationToken);
    if (!emailSent) {
      logger.error(`[Auth/ResendVerif] Failed to send email to ${user.email}`);
    } else {
      logger.info(`[Auth/ResendVerif] Verification email resent to ${user.email}`);
    }
    
    res.json({ ok: true, message: 'Verification link sent' });
  } catch (err: any) {
    logger.error(`[Auth/ResendVerification] Error: ${err.message}`);
    res.status(500).json({ error: 'Failed to resend verification link' });
  }
});

// ── POST /api/auth/forgot-password ──────────────────────────────────────────
router.post('/forgot-password', async (req: express.Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await users.findByEmail(email);
    if (!user) {
      return res.json({ ok: true, message: 'If the email exists, a reset link has been sent.' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    await users.update(user.id, { reset_token: resetToken });

    const emailSent = await sendResetPasswordEmail(user.email, resetToken);
    if (!emailSent) {
      logger.error(`[Auth/ForgotPassword] Failed to send email to ${user.email}`);
    }
    
    res.json({ ok: true, message: 'Password reset link sent' });
  } catch (err: any) {
    logger.error(`[Auth/ForgotPassword] Error: ${err.message}`);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// ── POST /api/auth/reset-password ───────────────────────────────────────────
router.post('/reset-password', async (req: express.Request, res: Response) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and password are required' });

    const user = await prisma.user.findFirst({
      where: { reset_token: token }
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await users.update(user.id, {
      password_hash: passwordHash,
      reset_token: null,
    });

    res.json({ ok: true, message: 'Password has been reset successfully' });
  } catch (err: any) {
    logger.error(`[Auth/ResetPassword] Error: ${err.message}`);
    res.status(500).json({ error: 'Failed to reset password' });
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
      return res.status(400).json({ error: 'Google token is required' });
    }

    const client = getGoogleClient();
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload) {
      return res.status(400).json({ error: 'Invalid Google token' });
    }

    const { email, name, picture } = payload;
    let user = await users.findByEmail(email!);

    if (!user) {
      user = await users.create({
        username: (name || 'user').replace(/\s/g, '_').toLowerCase() + Math.floor(Math.random() * 1000),
        email: email!,
        passwordHash: 'GOOGLE_AUTH',
        avatarUrl: picture || undefined,
      });
      await users.update(user.id, { verified: true });
    }

    const sessionToken = signToken({ userId: user.id });
    res.json({ user: users.public(user), token: sessionToken });
  } catch (err: any) {
    logger.error(`[Auth/Google] Error: ${err.message}`);
    res.status(500).json({ error: 'Google login failed' });
  }
});

export default router;
