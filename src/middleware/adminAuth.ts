import { Response, NextFunction } from 'express';
import { verifyToken } from '../lib/auth';
import { users } from '../lib/db';
import { AuthRequest } from './auth';

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export async function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = auth.slice(7);
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });

  const user = await users.findById(payload.userId).catch(() => null);
  if (!user) return res.status(401).json({ error: 'User not found' });

  const isAdmin = user.is_admin === true || ADMIN_EMAILS.includes((user.email || '').toLowerCase());
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  req.user = user;
  req.userId = user.id;
  next();
}
