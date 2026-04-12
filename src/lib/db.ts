import { Prisma, User } from '@prisma/client';
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

  async findByVerifyToken(token: string) {
    return await prisma.user.findFirst({
      where: { verify_token: token },
    });
  },

  async findByResetToken(token: string) {
    return await prisma.user.findFirst({
      where: { reset_token: token },
    });
  },

  async update(id: string, updates: Prisma.UserUpdateInput) {
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

  // Admin: Get dashboard stats
  async getAdminStats() {
    const totalUsers = await prisma.user.count();
    const activeGames24h = await prisma.game.count({
      where: {
        started_at: { gte: new Date(Date.now() - 24 * 3600000) },
      },
    });
    const recentSuspends7d = await prisma.antiCheatAction.count({
      where: {
        action: 'suspend',
        created_at: { gte: new Date(Date.now() - 7 * 24 * 3600000) },
      },
    });
    return { totalUsers, activeGames24h, recentSuspends7d };
  },

  // Admin: List users with pagination and search
  async listForAdmin(limit: number, offset: number, search?: string) {
    const where = search
      ? {
          OR: [
            { username: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          email: true,
          elo: true,
          trust_score: true,
          flagged: true,
          flagged_at: true,
          last_ip: true,
          created_at: true,
        },
        orderBy: { created_at: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.user.count({ where }),
    ]);

    return { users, total };
  },

  // Admin: Get user detail
  async getDetailForAdmin(id: string) {
    return await prisma.user.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            white_games: true,
            black_games: true,
            appeals: true,
          },
        },
      },
    });
  },

  public(user: User | null) {
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
  async create(data: Prisma.TransactionCreateInput) {
    return await prisma.transaction.create({
      data,
    });
  },

  async update(id: string, updates: Prisma.TransactionUpdateInput) {
    return await prisma.transaction.update({
      where: { id },
      data: {
        ...updates,
        updated_at: new Date(),
      },
    });
  },

  async findByOrderId(orderId: string) {
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
  async create(data: Prisma.GameCreateInput) {
    return await prisma.game.create({
      data,
    });
  },

  async findById(id: string) {
    return await prisma.game.findUnique({
      where: { id },
    });
  },

  async update(id: string, updates: Prisma.GameUpdateInput) {
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
  async create(userId: string, type: string, title: string, body: string, data: Prisma.InputJsonValue = {}) {
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
  async create(data: Prisma.AppealCreateInput) {
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

  async update(id: string, updates: Prisma.AppealUpdateInput) {
    return await prisma.appeal.update({
      where: { id },
      data: {
        ...updates,
        reviewed_at: new Date(),
      },
    });
  },

  async list(status: string) {
    return await prisma.appeal.findMany({
      where: { status: status as any },
      include: {
        user: { select: { id: true, username: true, elo: true, flagged: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  },

  async review(id: string, verdict: string, adminNote: string, adminId: string) {
    const appeal = await prisma.appeal.findUnique({ where: { id } });
    if (!appeal) throw new Error('Appeal not found');

    return await prisma.$transaction(async (tx) => {
      await tx.appeal.update({
        where: { id },
        data: {
          status: verdict as any,
          admin_note: adminNote,
          reviewed_at: new Date(),
          reviewed_by: adminId,
        },
      });

      if (verdict === 'accepted') {
        await tx.user.update({
          where: { id: appeal.user_id },
          data: { flagged: false, flagged_at: null },
        });
      }
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

  async create(data: Prisma.TournamentCreateInput) {
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

  async registerPlayer(data: Prisma.TournamentRegistrationCreateInput) {
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

// ── Anti-Cheat Actions ─────────────────────────────────────
export const antiCheatActions = {
  async list(limit: number, action?: string) {
    const actions = await prisma.antiCheatAction.findMany({
      where: action ? { action } : {},
      include: {
        user: {
          select: {
            id: true,
            username: true,
            elo: true,
            trust_score: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
      take: limit,
    });

    return actions.map((r) => ({
      id: r.id,
      action: r.action,
      reason: r.reason,
      flags: r.flags,
      score: r.score,
      created_at: r.created_at,
      users: r.user,
    }));
  },

  async getByUserId(userId: string) {
    return await prisma.antiCheatAction.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
    });
  },
};

// ── Collusion Flags ───────────────────────────────────────
export const collusionFlags = {
  async create(data: Prisma.CollusionFlagCreateInput) {
    return await prisma.collusionFlag.create({
      data,
    });
  },

  async listPending() {
    const flags = await prisma.collusionFlag.findMany({
      where: { reviewed: false },
      include: {
        user_a: { select: { id: true, username: true, elo: true } },
        user_b: { select: { id: true, username: true, elo: true } },
      },
      orderBy: { detected_at: 'desc' },
      take: 50,
    });

    return flags.map((r) => ({
      ...r,
      userA: r.user_a,
      userB: r.user_b,
    }));
  },

  async review(id: string, verdict: string, note: string, adminId: string) {
    return await prisma.collusionFlag.update({
      where: { id },
      data: {
        reviewed: true,
        verdict,
        review_note: note,
        reviewed_at: new Date(),
        reviewed_by: adminId,
      },
    });
  },
};

// ── Multi-Account Flags ───────────────────────────────────
export const multiAccountFlags = {
  async create(data: Prisma.MultiAccountFlagCreateInput) {
    return await prisma.multiAccountFlag.create({
      data,
    });
  },

  async listPending() {
    const flags = await prisma.multiAccountFlag.findMany({
      where: { reviewed: false },
      include: {
        user_a: { select: { id: true, username: true, email: true } },
        user_b: { select: { id: true, username: true, email: true } },
      },
      orderBy: { detected_at: 'desc' },
      take: 50,
    });

    return flags.map((r) => ({
      ...r,
      userA: r.user_a,
      userB: r.user_b,
    }));
  },

  async review(id: string, verdict: string, note: string, adminId: string) {
    return await prisma.multiAccountFlag.update({
      where: { id },
      data: {
        reviewed: true,
        verdict,
        review_note: note,
        reviewed_at: new Date(),
        reviewed_by: adminId,
      },
    });
  },
};
