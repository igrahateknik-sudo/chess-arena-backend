import { z } from 'zod';

// ── Auth Schemas ──────────────────────────────────────────────────────────
export const registerSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'),
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const verifyCodeSchema = z.object({
  code: z.string().length(6, 'Verification code must be 6 characters'),
});

export const resendVerificationSchema = z.object({
  email: z.string().email(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

// ── Common Schemas ────────────────────────────────────────────────────────
export const paginationSchema = z.object({
  limit: z.preprocess((val) => parseInt(val as string, 10), z.number().min(1).max(100).default(50)),
  offset: z.preprocess((val) => parseInt(val as string, 10), z.number().min(0).default(0)),
  search: z.string().optional(),
});

// ── Admin Schemas ─────────────────────────────────────────────────────────
export const adminReviewUserSchema = z.object({
  action: z.enum(['warn', 'suspend', 'none']),
  reason: z.string().min(1, 'Reason is required'),
  score: z.number().optional(),
  flags: z.array(z.string()).optional(),
});

export const adminReviewFlagSchema = z.object({
  verdict: z.enum(['confirmed', 'dismissed']),
  note: z.string().optional(),
});

export const adminReviewAppealSchema = z.object({
  verdict: z.enum(['accepted', 'rejected']),
  admin_note: z.string().optional(),
});

export const adminListSchema = z.object({
  limit: z.preprocess((val) => parseInt(val as string, 10), z.number().min(1).max(100).default(50)),
  offset: z.preprocess((val) => parseInt(val as string, 10), z.number().min(0).default(0)),
  search: z.string().optional(),
  status: z.string().optional(),
  action: z.string().optional(),
});

// ── Game Schemas ──────────────────────────────────────────────────────────
export const gameListSchema = z.object({
  limit: z.preprocess((val) => parseInt(val as string, 10), z.number().min(1).max(100).default(20)),
});
