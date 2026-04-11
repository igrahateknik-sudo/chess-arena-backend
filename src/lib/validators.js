// src/lib/validators.js
const z = require('zod');

const registerSchema = z.object({
  username: z.string()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username must be at most 30 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address').optional(),
  username: z.string().optional(),
  password: z.string().min(1, 'Password is required'),
}).refine(data => data.email || data.username, {
  message: 'Either email or username must be provided',
  path: ['email', 'username']
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(6, 'New password must be at least 6 characters'),
});

const profileUpdateSchema = z.object({
  country: z.string().optional(),
  avatar_url: z.string().url('Invalid avatar URL').optional(),
});

const depositSchema = z.object({
  amount: z.number().min(10000, 'Minimum deposit is Rp 10,000').max(100000000, 'Maximum deposit is Rp 100,000,000'),
});

const withdrawSchema = z.object({
  amount: z.number().min(50000, 'Minimum withdrawal is Rp 50,000'),
  bankCode: z.string().min(1, 'Bank code is required'),
  accountNumber: z.string().min(5, 'Invalid account number'),
  accountName: z.string().min(2, 'Account name is required'),
});

const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  newPassword: z.string().min(6, 'New password must be at least 6 characters'),
});

module.exports = {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  profileUpdateSchema,
  depositSchema,
  withdrawSchema,
  verifyEmailSchema,
  forgotPasswordSchema,
  resetPasswordSchema
};