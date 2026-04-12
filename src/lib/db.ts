import prisma from './prisma';

// ── Users ─────────────────────────────────────────────────────────────────
export const users = {
  async create({
    username,
    email,
    passwordHash,
    avatarUrl,
  }: {
    username: string;
    email: string;
    passwordHash: string;
    avatarUrl?: string;
  }) {
    const finalAvatarUrl =
      avatarUrl || `https://api.dicebear.com/9.x/avataaars/svg?seed=${username}`;
    return await prisma.user.create({
      data: {
        username,
        email,
        password_hash: passwordHash,
        avatar_url: finalAvatarUrl,
      },
    });
  },

  async findByEmail(email: string) {
    return await prisma.user.findUnique({
      where: { email },
    });
  },

  async findByUsername(username: string) {
    return await prisma.user.findFirst({
      where: {
        username: {
          equals: username,
          mode: 'insensitive',
        },
      },
    });
  },

  async findById(id: string) {
    return await prisma.user.findUnique({
      where: { id },
    });
  },

  async update(id: string, updates: any) {
    return await prisma.user.update({
      where: { id },
      data: {
        ...updates,
        updated_at: new Date(),
      },
    });
  },

  async setOnline(id: string, socketId: string) {
    await prisma.user.update({
      where: { id },
      data: { online: true, socket_id: socketId },
    });
  },

  async setOffline(id: string) {
    await prisma.user.update({
      where: { id },
      data: { online: false, socket_id: null },
    });
  },

  async getLeaderboard(limit = 50) {
    return await prisma.user.findMany({
      where: {
        games_played: { gt: 0 },
      },
      select: {
        id: true,
        username: true,
        elo: true,
        title: true,
        country: true,
        avatar_url: true,
        wins: true,
        losses: true,
        draws: true,
        games_played: true,
      },
      orderBy: {
        elo: 'desc',
      },
      take: limit,
    });
  },

  public(user: any) {
    if (!user) return null;
    const { password_hash: _, verify_token: __, reset_token: ___, ...pub } = user;
    return pub;
  },
};

// ── Wallets ───────────────────────────────────────────────────────────────
export const wallets = {
  async get(userId: string) {
    return await prisma.wallet.findUnique({
      where: { user_id: userId },
    });
  },

  async getBalance(userId: string) {
    const wallet = await prisma.wallet.findUnique({
      where: { user_id: userId },
      select: { balance: true, locked: true },
    });
    return wallet || { balance: 0n, locked: 0n };
  },

  async credit(userId: string, amount: bigint) {
    return await prisma.$queryRaw`SELECT credit_wallet(${userId}::uuid, ${amount})`;
  },

  async debit(userId: string, amount: bigint) {
    return await prisma.$queryRaw`SELECT debit_wallet(${userId}::uuid, ${amount})`;
  },

  async lock(userId: string, amount: bigint) {
    await prisma.$queryRaw`SELECT lock_wallet_funds(${userId}::uuid, ${amount})`;
  },

  async unlock(userId: string, amount: bigint) {
    await prisma.$queryRaw`SELECT unlock_wallet_funds(${userId}::uuid, ${amount})`;
  },

  async settleGamePayout(
    winnerId: string | null,
    loserId: string | null,
    whiteId: string,
    blackId: string,
    stakes: bigint,
    fee: bigint,
  ) {
    await prisma.$queryRaw`SELECT settle_game_payout(
      ${winnerId}::uuid, 
      ${loserId}::uuid, 
      ${whiteId}::uuid, 
      ${blackId}::uuid, 
      ${stakes}, 
      ${fee}
    )`;
  },
};

// ── Transactions ──────────────────────────────────────────
export const transactions = {
  async create(data: any) {
    return await prisma.transaction.create({
      data,
    });
  },

  async update(id: string, updates: any) {
    return await prisma.transaction.update({
      where: { id },
      data: {
        ...updates,
        updated_at: new Date(),
      },
    });
  },

  async findByOrderId(orderId: string) {
    // midtrans_order_id digunakan sebagai field umum untuk orderId (iPaymu/Midtrans)
    return await prisma.transaction.findUnique({
      where: { midtrans_order_id: orderId },
    });
  },

  async findByUserId(userId: string, limit = 30) {
    return await prisma.transaction.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: limit,
    });
  },
};

// ── Games ─────────────────────────────────────────────────────────────────
export const games = {
  async create(data: any) {
    return await prisma.game.create({
      data,
    });
  },

  async findById(id: string) {
    return await prisma.game.findUnique({
      where: { id },
    });
  },

  async update(id: string, updates: any) {
    return await prisma.game.update({
      where: { id },
      data: updates,
    });
  },

  async findActiveByUser(userId: string) {
    return await prisma.game.findFirst({
      where: {
        OR: [{ white_id: userId }, { black_id: userId }],
        status: 'active',
      },
    });
  },

  async getHistory(userId: string, limit = 20) {
    return await prisma.game.findMany({
      where: {
        OR: [{ white_id: userId }, { black_id: userId }],
        status: { not: 'active' },
      },
      include: {
        white_player: {
          select: { username: true, elo: true, avatar_url: true },
        },
        black_player: {
          select: { username: true, elo: true, avatar_url: true },
        },
      },
      orderBy: { ended_at: 'desc' },
      take: limit,
    });
  },
};

// ── Notifications ─────────────────────────────────────────
export const notifications = {
  async create(userId: string, type: string, title: string, body: string, data: any = {}) {
    await prisma.notification.create({
      data: {
        user_id: userId,
        type,
        title,
        body,
        data,
      },
    });
  },

  async getUnread(userId: string) {
    return await prisma.notification.findMany({
      where: { user_id: userId, read: false },
      orderBy: { created_at: 'desc' },
      take: 20,
    });
  },

  async markAllRead(userId: string) {
    await prisma.notification.updateMany({
      where: { user_id: userId, read: false },
      data: { read: true },
    });
  },
};

// ── ELO History ───────────────────────────────────────────
export const eloHistory = {
  async create(userId: string, eloBefore: number, eloAfter: number, gameId: string) {
    await prisma.eloHistory.create({
      data: {
        user_id: userId,
        elo_before: eloBefore,
        elo_after: eloAfter,
        change: eloAfter - eloBefore,
        game_id: gameId,
      },
    });
  },

  async getForUser(userId: string, limit = 30) {
    return await prisma.eloHistory.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: limit,
    });
  },
};

// ── Appeals ───────────────────────────────────────────────
export const appeals = {
  async create(data: any) {
    return await prisma.appeal.create({
      data,
    });
  },

  async findById(id: string) {
    return await prisma.appeal.findUnique({
      where: { id },
    });
  },

  async findByUser(userId: string) {
    return await prisma.appeal.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
    });
  },

  async countByUser(userId: string) {
    return await prisma.appeal.count({
      where: { user_id: userId },
    });
  },

  async findPendingByUser(userId: string) {
    return await prisma.appeal.findFirst({
      where: { user_id: userId, status: 'pending' },
    });
  },

  async update(id: string, updates: any) {
    return await prisma.appeal.update({
      where: { id },
      data: {
        ...updates,
        reviewed_at: new Date(),
      },
    });
  },
};

// ── Tournaments ───────────────────────────────────────────
export const tournaments = {
  async list(status?: string) {
    return await prisma.tournament.findMany({
      where: status ? { status } : {},
      orderBy: { starts_at: 'asc' },
    });
  },

  async findById(id: string) {
    return await prisma.tournament.findUnique({
      where: { id },
    });
  },

  async create(data: any) {
    return await prisma.tournament.create({
      data,
    });
  },

  async getRegistrationCount(id: string) {
    return await prisma.tournamentRegistration.count({
      where: { tournament_id: id },
    });
  },

  async findRegistration(tournamentId: string, userId: string) {
    return await prisma.tournamentRegistration.findUnique({
      where: {
        tournament_id_user_id: {
          tournament_id: tournamentId,
          user_id: userId,
        },
      },
    });
  },

  async registerPlayer(data: any) {
    return await prisma.tournamentRegistration.create({
      data,
    });
  },

  async getPlayers(id: string) {
    return await prisma.tournamentRegistration.findMany({
      where: { tournament_id: id },
      include: {
        user: {
          select: {
            username: true,
            elo: true,
            avatar_url: true,
            title: true,
            country: true,
          },
        },
      },
      orderBy: { score: 'desc' },
    });
  },
};

// ── Collusion Flags ───────────────────────────────────────
export const collusionFlags = {
  async create(data: any) {
    return await prisma.collusionFlag.create({
      data,
    });
  },
};

// ── Multi-Account Flags ───────────────────────────────────
export const multiAccountFlags = {
  async create(data: any) {
    return await prisma.multiAccountFlag.create({
      data,
    });
  },
};
