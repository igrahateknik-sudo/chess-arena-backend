import express, { Response, Request } from 'express';
import bcrypt from 'bcryptjs';
import { users } from '../lib/db';
import { signToken } from '../lib/auth';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { OAuth2Client } from 'google-auth-library';
import logger from '../lib/logger';
import { sendVerificationEmail, sendResetPasswordEmail } from '../lib/email';
import crypto from 'crypto';
import validate from '../middleware/validate';
import { 
  registerSchema, 
  loginSchema, 
  verifyCodeSchema, 
  resendVerificationSchema, 
  forgotPasswordSchema, 
  resetPasswordSchema 
} from '../lib/validators';

const router = express.Router();

const getGoogleClient = () => {
  return new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
};

// ── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register', validate(registerSchema), async (req: Request, res: Response) => {
  const { username, email, password } = req.body;
  logger.info(`[Auth/Register] Attempt for email: ${email}`);

  try {
    const existing = await users.findByEmail(email);
    if (existing) {
      logger.warn(`[Auth/Register] Email already exists: ${email}`);
      return res.status(400).json({ error: 'Email already exists' });
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const passwordHash = await bcrypt.hash(password, 10);

    const user = await users.create({
      username,
      email,
      passwordHash,
    });

    await users.update(user.id, { verify_token: verificationToken });
    
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

// ── GET /api/auth/verify-link ───────────────────────────────────────────────
router.get('/verify-link', async (req: Request, res: Response) => {
  const { token } = req.query;
  if (!token || typeof token !== 'string') {
    return res.status(400).send('<h1>Link Verifikasi Tidak Valid</h1>');
  }

  try {
    const user = await users.findByVerifyToken(token);

    if (!user) {
      return res.status(400).send('<h1>Link Verifikasi Kadaluarsa atau Tidak Valid</h1>');
    }

    await users.update(user.id, {
      verified: true,
      verify_token: null,
    });

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

// ── POST /api/auth/verify (Input Kode) ─────────────────────────────────────
router.post('/verify', requireAuth, validate(verifyCodeSchema), async (req: AuthRequest, res: Response) => {
  const { code } = req.body;
  const userId = req.userId!;

  try {
    const user = await users.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

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

// ── POST /api/auth/resend-verification ──────────────────────────────────────
router.post('/resend-verification', validate(resendVerificationSchema), async (req: Request, res: Response) => {
  const { email } = req.body;
  
  try {
    const user = await users.findByEmail(email);
    if (!user) {
      return res.json({ ok: true, message: 'If the email exists, a new link has been sent.' });
    }

    if (user.verified) {
      return res.status(400).json({ error: 'Email already verified' });
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    await users.update(user.id, { verify_token: verificationToken });
    await sendVerificationEmail(user.email, verificationToken);
    
    res.json({ ok: true, message: 'Verification link sent' });
  } catch (err: any) {
    logger.error(`[Auth/ResendVerification] Error: ${err.message}`);
    res.status(500).json({ error: 'Failed to resend verification link' });
  }
});

// ── POST /api/auth/forgot-password ──────────────────────────────────────────
router.post('/forgot-password', validate(forgotPasswordSchema), async (req: Request, res: Response) => {
  const { email } = req.body;

  try {
    const user = await users.findByEmail(email);
    if (!user) {
      return res.json({ ok: true, message: 'If the email exists, a reset link has been sent.' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    await users.update(user.id, { reset_token: resetToken });
    await sendResetPasswordEmail(user.email, resetToken);
    
    res.json({ ok: true, message: 'Password reset link sent' });
  } catch (err: any) {
    logger.error(`[Auth/ForgotPassword] Error: ${err.message}`);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// ── POST /api/auth/reset-password ───────────────────────────────────────────
router.post('/reset-password', validate(resetPasswordSchema), async (req: Request, res: Response) => {
  const { token, password } = req.body;

  try {
    const user = await users.findByResetToken(token);

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
router.post('/login', validate(loginSchema), async (req: Request, res: Response) => {
  const { email, password } = req.body;

  try {
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
router.post('/guest', async (_req: Request, res: Response) => {
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
router.post('/google', async (req: Request, res: Response) => {
  const token = req.body.token || req.body.credential || req.body.idToken || req.body.id_token;

  if (!token) {
    return res.status(400).json({ error: 'Google token is required' });
  }

  try {
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
