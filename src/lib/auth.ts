import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'chess-arena-secret-2024';
const JWT_EXPIRES = '7d';

export function signToken(payload: string | object | Buffer): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

export function verifyToken(token: string): any {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}
