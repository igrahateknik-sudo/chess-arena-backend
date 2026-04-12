import { PrismaClient } from '@prisma/client';
import logger from './logger';

const dbUrl = process.env.DATABASE_URL || '';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: dbUrl,
    },
  },
  log: [
    { level: 'error', emit: 'event' },
    { level: 'warn', emit: 'event' },
  ],
});

// ── Prisma Events ──────────────────────────────────────────────────────────
prisma.$on('error' as any, (e: any) => {
  logger.error(`[Prisma-Event] Error: ${e.message}`);
});

prisma.$on('warn' as any, (e: any) => {
  logger.warn(`[Prisma-Event] Warning: ${e.message}`);
});

// ── Query Monitoring Middleware ─────────────────────────────────────────────
prisma.$use(async (params, next) => {
  const before = Date.now();
  const result = await next(params);
  const after = Date.now();

  if (after - before > 1000) {
    logger.warn(`[Prisma-Slow] ${params.model}.${params.action} took ${after - before}ms`);
  }
  return result;
});

// ── Connection Verification ─────────────────────────────────────────────────
export const testDbConnection = async (retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      logger.info(`[Database] Connection successful (Attempt ${i + 1})`);
      return true;
    } catch (err: any) {
      logger.error(`[Database] Connection attempt ${i + 1} failed: ${err.message}`);
      if (i < retries - 1) await new Promise((res) => setTimeout(res, 5000));
    }
  }
  return false;
};

export default prisma;
export * from '@prisma/client';
