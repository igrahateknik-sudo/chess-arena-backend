const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { verifyToken } = require('./lib/auth');
const { users } = require('./lib/db');
const redis = require('./lib/redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const { registerMatchmaking, queues } = require('./socket/matchmaking');
const { registerGameRoom, gameCache } = require('./socket/gameRoom');
const { startMonitor }                = require('./lib/monitor');
const { startTournamentMonitor }      = require('./lib/tournamentScheduler');

const app = express();
const server = http.createServer(app);

const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ||
  'http://localhost:3000,https://chess-app-two-kappa.vercel.app'
).split(',').map(s => s.trim());

// Setup Redis Adapter for Socket.io
const pubClient = redis;
const subClient = pubClient.duplicate();
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
// [SECURITY] CSP diaktifkan — tidak ada lagi contentSecurityPolicy: false
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      // API server: izinkan koneksi WebSocket dari allowed origins
      connectSrc: ["'self'", ...ALLOWED_ORIGINS],
      // Tidak ada script/style di-serve dari sini, tapi tetap set defaults
      upgradeInsecureRequests: [],
    },
  },
  // Strict headers tambahan
  crossOriginEmbedderPolicy: false,  // dinonaktifkan agar tidak break socket.io polling
}));
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(morgan('combined'));

// NOTE: express.raw() removed — it conflicts with route-level express.json()
// by setting req._body=true which prevents subsequent json parsing,
// causing req.body to remain a Buffer. Webhook signature is verified via
// field-based SHA-512 hash (order_id + status_code + gross_amount + serverKey),
// which does not require the raw body bytes.
app.use(express.json({ limit: '1mb' }));

// ── REST Routes ──────────────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/game', require('./routes/game'));
app.use('/api/leaderboard', require('./routes/leaderboard'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/tournament', require('./routes/tournament'));
app.use('/api/webhook', require('./routes/webhook'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/appeal', require('./routes/appeal'));
app.use('/api/admin', require('./routes/admin'));

app.get('/health', (req, res) => {
  const queueCounts = {};
  for (const [key, queue] of queues.entries()) {
    queueCounts[key] = queue.length;
  }
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    connectedSockets: io.sockets.sockets.size,
    activeGames: [...gameCache.values()].filter(g => g.status === 'active').length,
    queues: queueCounts,
    timestamp: new Date().toISOString(),
  });
});

// ── Socket.io Auth Middleware ────────────────────────────────────────────────
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));

  const payload = verifyToken(token);
  if (!payload) return next(new Error('Invalid token'));

  try {
    const user = await users.findById(payload.userId);
    if (!user) return next(new Error('User not found'));

    socket.userId = payload.userId;
    socket.username = user.username;
    socket.userElo = user.elo;
    next();
  } catch (err) {
    next(new Error('Auth error'));
  }
});

// ── Socket.io Connection ─────────────────────────────────────────────────────
io.on('connection', async (socket) => {
  const { userId, username } = socket;
  console.log(`[Socket] ${username} connected (${socket.id})`);

  // Join per-user room untuk direct messaging
  socket.join(userId);

  // Mark online in DB
  await users.setOnline(userId, socket.id).catch(() => {});

  // Broadcast updated online count + active games
  const onlineCount = io.sockets.sockets.size;
  const activeGames = [...gameCache.values()].filter(g => g.status === 'active').length;
  io.emit('lobby:online', { count: onlineCount, activeGames });

  // Register feature handlers
  registerMatchmaking(io, socket, userId);
  registerGameRoom(io, socket, userId);

  // ── Lobby chat ───────────────────────────────────────────────────────────
  socket.on('lobby:chat', ({ message }) => {
    if (!message || !message.trim()) return;
    io.emit('lobby:chat', {
      from: username,
      fromId: userId,
      message: message.trim().slice(0, 200),
      timestamp: Date.now(),
    });
  });

  // ── Disconnect ───────────────────────────────────────────────────────────
  socket.on('disconnect', async () => {
    await users.setOffline(userId).catch(() => {});
    const onlineCountAfter = io.sockets.sockets.size;
    const activeGamesAfter = [...gameCache.values()].filter(g => g.status === 'active').length;
    io.emit('lobby:online', { count: onlineCountAfter, activeGames: activeGamesAfter });
    console.log(`[Socket] ${username} disconnected`);
  });
});

// ── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n♔ Chess Arena Backend (Google Cloud)`);
  console.log(`─────────────────────────────────`);
  console.log(`  HTTP  : http://0.0.0.0:${PORT}`);
  console.log(`  WS    : ws://0.0.0.0:${PORT}`);
  console.log(`  Health: http://0.0.0.0:${PORT}/health`);
  console.log(`  DB    : PostgreSQL`);
  console.log(`  Pay   : iPaymu`);
  console.log(`  Env   : ${process.env.NODE_ENV || 'development'}`);
  console.log(`─────────────────────────────────\n`);

  // Start admin review queue monitor (hanya di long-running server, bukan serverless)
  startMonitor();
  startTournamentMonitor(io);
});

module.exports = server;
