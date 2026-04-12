import express, { Request, Response } from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { verifyToken } from './lib/auth';
import { users } from './lib/db';
import redis from './lib/redis';
import prisma from './lib/prisma';
import logger from './lib/logger';
import errorHandler from './middleware/errorHandler';
import { createAdapter } from '@socket.io/redis-adapter';

// ── Import Routes ───────────────────────────────────────────────────────────
import authRoutes from './routes/auth';
import gameRoutes from './routes/game';
import leaderboardRoutes from './routes/leaderboard';
import walletRoutes from './routes/wallet';
import tournamentRoutes from './routes/tournament';
import webhookRoutes from './routes/webhook';
import notificationRoutes from './routes/notifications';
import appealRoutes from './routes/appeal';
import adminRoutes from './routes/admin';

// ── Import Socket Handlers & Monitors ───────────────────────────────────────
import { registerMatchmaking, queues } from './socket/matchmaking';
import { registerGameRoom } from './socket/gameRoom';
import { startMonitor } from './lib/monitor';
import { startTournamentMonitor } from './lib/tournamentScheduler';

interface CustomSocket extends Socket {
  userId?: string;
  username?: string;
}

const app = express();
const server = http.createServer(app);

const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ||
  'http://localhost:3000,https://chess-app-two-kappa.vercel.app,https://www.chess-arena.app,https://chess-arena.app'
)
  .split(',')
  .map((s) => s.trim());

// ── Setup Redis Adapter (Socket.io) ─────────────────────────────────────────
const pubClient = redis;
const subClient = pubClient.duplicate();

// Memberikan Error Handler pada koneksi duplikat (Pondasi Kuat)
subClient.on('error', (err) => {
  logger.error(`[Redis-Sub] Connection Error: ${err.message}`);
});

const io = new Server(server, {
  adapter: createAdapter(pubClient, subClient),
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet({ crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));
app.use(express.json({ limit: '1mb' }));

// ── REST Routes ──────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/game', gameRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/tournament', tournamentRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/appeal', appealRoutes);
app.use('/api/admin', adminRoutes);

// ── Health Check (Real-time monitoring) ──────────────────────────────────────
app.get('/health', async (_req: Request, res: Response) => {
  const queueCounts: Record<string, number> = {};
  if (queues instanceof Map) {
    for (const [key, queue] of queues.entries()) {
      queueCounts[key] = (queue as any[]).length;
    }
  }

  let dbStatus = 'ok';
  let redisStatus = 'ok';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (_e) {
    dbStatus = 'error';
  }
  try {
    await redis.ping();
  } catch (_e) {
    redisStatus = 'error';
  }

  const mem = process.memoryUsage();
  res.json({
    status: dbStatus === 'ok' && redisStatus === 'ok' ? 'healthy' : 'unhealthy',
    database: dbStatus,
    redis: redisStatus,
    uptime: Math.round(process.uptime()),
    sockets: io.sockets.sockets.size,
    activeGames: 0, // Migrated to Redis, count requires SCAN
    queues: queueCounts,
    memory: `${Math.round(mem.rss / 1024 / 1024)}MB`,
    timestamp: new Date().toISOString(),
  });
});

// ── Catch-all 404 Handler (Prevents HTML default response) ───────────────────
app.use((req: Request, res: Response) => {
  res.status(404).json({
    status: 'error',
    statusCode: 404,
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
});

app.use(errorHandler);

// ── Socket.io Authentication ─────────────────────────────────────────────────
io.use(async (socket: Socket, next) => {
  const cs = socket as CustomSocket;
  const token = cs.handshake.auth?.token;
  if (!token) return next(new Error('Auth required'));

  const payload = verifyToken(token) as any;
  if (!payload) return next(new Error('Invalid token'));

  try {
    const user = await users.findById(payload.userId);
    if (!user) return next(new Error('User not found'));
    cs.userId = user.id;
    cs.username = user.username;
    next();
  } catch (_err) {
    next(new Error('DB error'));
  }
});

io.on('connection', (socket: Socket) => {
  const cs = socket as CustomSocket;
  logger.info(`[Socket] Connected: ${cs.username}`);
  if (cs.userId) {
    registerMatchmaking(io, cs, cs.userId);
    registerGameRoom(io, cs, cs.userId);
  }
  socket.on('disconnect', () => logger.info(`[Socket] Disconnected: ${cs.username}`));
});

// ── Background Jobs ──────────────────────────────────────────────────────────
startMonitor();
startTournamentMonitor(io);

const PORT = process.env.PORT || 8080;

// ── Startup ──────────────────────────────────────────────────────────────────
import { testDbConnection } from './lib/prisma';

async function bootstrap() {
  const dbOk = await testDbConnection();
  if (!dbOk) {
    logger.warn('[Server] Starting with DB in degraded mode. Some features may fail.');
  }

  server.listen(PORT, () => {
    logger.info(`[Server] Chess Arena Backend v1.0 running on port ${PORT}`);
  });
}

bootstrap();

export { io };
