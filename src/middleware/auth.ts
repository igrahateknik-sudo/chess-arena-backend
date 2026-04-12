import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/auth';
import { users } from '../lib/db';

export interface AuthRequest extends Request {
  user?: any;
  userId?: string;
}

/**
 * Express middleware — requires valid JWT, attaches req.user
 */
export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = auth.slice(7);
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });

  const user = await users.findById(payload.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });

  req.user = user;
  req.userId = user.id;
  next();
}

/**
 * Optional auth — attaches req.user if token present, but doesn't block
 */
export async function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      const token = auth.slice(7);
      const payload = verifyToken(token);
      if (payload) {
        const user = await users.findById(payload.userId);
        if (user) {
          req.user = user;
          req.userId = user.id;
        }
      }
    }
  } catch {
    /* ignore */
  }
  next();
}
