const { Pool } = require('pg');

// Konfigurasi Pool PostgreSQL
const poolConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: false, // Cloud SQL Proxy handles security, no need for manual PG SSL
};

// Jika menggunakan Cloud SQL Auth Proxy via Unix Socket
if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('/cloudsql/')) {
  const parts = process.env.DATABASE_URL.split('@');
  const dbName = parts[1].split('/')[1].split('?')[0];
  const instanceConnectionName = process.env.DATABASE_URL.split('host=/cloudsql/')[1];
  
  poolConfig.host = `/cloudsql/${instanceConnectionName}`;
  poolConfig.database = dbName;
}

const pool = new Pool(poolConfig);

// Helper untuk query SQL
const query = (text, params) => pool.query(text, params);

// ── Users ─────────────────────────────────────────────────────────────────
const users = {
  async create({ username, email, passwordHash }) {
    const avatarUrl = `https://api.dicebear.com/9.x/avataaars/svg?seed=${username}`;
    const sql = `
      INSERT INTO users (username, email, password_hash, avatar_url)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    const res = await query(sql, [username, email, passwordHash, avatarUrl]);
    return res.rows[0];
  },

  async findByEmail(email) {
    const res = await query('SELECT * FROM users WHERE email = $1', [email]);
    return res.rows[0];
  },

  async findByUsername(username) {
    const res = await query('SELECT * FROM users WHERE username ILIKE $1', [username]);
    return res.rows[0];
  },

  async findById(id) {
    const res = await query('SELECT * FROM users WHERE id = $1', [id]);
    return res.rows[0];
  },

  async update(id, updates) {
    const keys = Object.keys(updates);
    const values = Object.values(updates);
    const setClause = keys.map((key, i) => `${key} = $${i + 2}`).join(', ');
    const sql = `UPDATE users SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`;
    const res = await query(sql, [id, ...values]);
    return res.rows[0];
  },

  async setOnline(id, socketId) {
    await query('UPDATE users SET online = true, socket_id = $2 WHERE id = $1', [id, socketId]);
  },

  async setOffline(id) {
    await query('UPDATE users SET online = false, socket_id = NULL WHERE id = $1', [id]);
  },

  async getLeaderboard(limit = 50) {
    const sql = `
      SELECT id, username, elo, title, country, avatar_url, wins, losses, draws, games_played
      FROM users
      WHERE games_played > 0
      ORDER BY elo DESC
      LIMIT $1
    `;
    const res = await query(sql, [limit]);
    return res.rows;
  },

  public(user) {
    if (!user) return null;
    const { password_hash, verify_token, reset_token, ...pub } = user;
    return pub;
  },
};

// ── Wallets ───────────────────────────────────────────────────────────────
const wallets = {
  async get(userId) {
    const res = await query('SELECT * FROM wallets WHERE user_id = $1', [userId]);
    return res.rows[0];
  },

  async getBalance(userId) {
    const res = await query('SELECT balance, locked FROM wallets WHERE user_id = $1', [userId]);
    return res.rows[0] || { balance: 0, locked: 0 };
  },

  async credit(userId, amount) {
    const res = await query('SELECT credit_wallet($1, $2)', [userId, amount]);
    return res.rows[0];
  },

  async debit(userId, amount) {
    const res = await query('SELECT debit_wallet($1, $2)', [userId, amount]);
    return res.rows[0];
  },

  async lock(userId, amount) {
    await query('SELECT lock_wallet_funds($1, $2)', [userId, amount]);
  },

  async unlock(userId, amount) {
    await query('SELECT unlock_wallet_funds($1, $2)', [userId, amount]);
  },

  async settleGamePayout(winnerId, loserId, whiteId, blackId, stakes, fee) {
    await query('SELECT settle_game_payout($1, $2, $3, $4, $5, $6)', [
      winnerId, loserId, whiteId, blackId, stakes, fee
    ]);
  },
};

// ── Transactions ──────────────────────────────────────────────────────────
const transactions = {
  async create(data) {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `INSERT INTO transactions (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`;
    const res = await query(sql, values);
    return res.rows[0];
  },

  async update(id, updates) {
    const keys = Object.keys(updates);
    const values = Object.values(updates);
    const setClause = keys.map((key, i) => `${key} = $${i + 2}`).join(', ');
    const sql = `UPDATE transactions SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`;
    const res = await query(sql, [id, ...values]);
    return res.rows[0];
  },

  async findByOrderId(orderId) {
    const res = await query('SELECT * FROM transactions WHERE midtrans_order_id = $1', [orderId]);
    return res.rows[0];
  },

  async findByUserId(userId, limit = 30) {
    const sql = `SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`;
    const res = await query(sql, [userId, limit]);
    return res.rows;
  },
};

// ── Games ─────────────────────────────────────────────────────────────────
const games = {
  async create(data) {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `INSERT INTO games (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`;
    const res = await query(sql, values);
    return res.rows[0];
  },

  async findById(id) {
    const res = await query('SELECT * FROM games WHERE id = $1', [id]);
    return res.rows[0];
  },

  async update(id, updates) {
    const keys = Object.keys(updates);
    const values = Object.values(updates);
    const setClause = keys.map((key, i) => `${key} = $${i + 2}`).join(', ');
    const sql = `UPDATE games SET ${setClause} WHERE id = $1 RETURNING *`;
    const res = await query(sql, [id, ...values]);
    return res.rows[0];
  },

  async findActiveByUser(userId) {
    const sql = `SELECT * FROM games WHERE (white_id = $1 OR black_id = $1) AND status = 'active' LIMIT 1`;
    const res = await query(sql, [userId]);
    return res.rows[0];
  },

  async getHistory(userId, limit = 20) {
    const sql = `
      SELECT g.*, 
             w.username as white_username, w.elo as white_elo, w.avatar_url as white_avatar,
             b.username as black_username, b.elo as black_elo, b.avatar_url as black_avatar
      FROM games g
      LEFT JOIN users w ON g.white_id = w.id
      LEFT JOIN users b ON g.black_id = b.id
      WHERE (white_id = $1 OR black_id = $1) AND status != 'active'
      ORDER BY ended_at DESC
      LIMIT $2
    `;
    const res = await query(sql, [userId, limit]);
    return res.rows;
  },
};

// ── Notifications ─────────────────────────────────────────────────────────
const notifications = {
  async create(userId, type, title, body, data = {}) {
    const sql = `INSERT INTO notifications (user_id, type, title, body, data) VALUES ($1, $2, $3, $4, $5)`;
    await query(sql, [userId, type, title, body, JSON.stringify(data)]);
  },

  async getUnread(userId) {
    const sql = `SELECT * FROM notifications WHERE user_id = $1 AND read = false ORDER BY created_at DESC LIMIT 20`;
    const res = await query(sql, [userId]);
    return res.rows;
  },

  async markAllRead(userId) {
    await query('UPDATE notifications SET read = true WHERE user_id = $1 AND read = false', [userId]);
  },
};

// ── ELO History ───────────────────────────────────────────────────────────
const eloHistory = {
  async create(userId, eloBefore, eloAfter, gameId) {
    const sql = `
      INSERT INTO elo_history (user_id, elo_before, elo_after, change, game_id)
      VALUES ($1, $2, $3, $4, $5)
    `;
    await query(sql, [userId, eloBefore, eloAfter, eloAfter - eloBefore, gameId]);
  },

  async getForUser(userId, limit = 30) {
    const sql = `SELECT * FROM elo_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`;
    const res = await query(sql, [userId, limit]);
    return res.rows;
  },
};

// ── Appeals ───────────────────────────────────────────────────────────────
const appeals = {
  async create(data) {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `INSERT INTO appeals (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`;
    const res = await query(sql, values);
    return res.rows[0];
  },

  async findById(id) {
    const res = await query('SELECT * FROM appeals WHERE id = $1', [id]);
    return res.rows[0];
  },

  async findByUser(userId) {
    const sql = `SELECT * FROM appeals WHERE user_id = $1 ORDER BY created_at DESC`;
    const res = await query(sql, [userId]);
    return res.rows;
  },

  async countByUser(userId) {
    const res = await query('SELECT COUNT(*) FROM appeals WHERE user_id = $1', [userId]);
    return parseInt(res.rows[0].count);
  },

  async findPendingByUser(userId) {
    const res = await query('SELECT * FROM appeals WHERE user_id = $1 AND status = \'pending\' LIMIT 1', [userId]);
    return res.rows[0];
  },

  async update(id, updates) {
    const keys = Object.keys(updates);
    const values = Object.values(updates);
    const setClause = keys.map((key, i) => `${key} = $${i + 2}`).join(', ');
    const sql = `UPDATE appeals SET ${setClause}, reviewed_at = NOW() WHERE id = $1 RETURNING *`;
    const res = await query(sql, [id, ...values]);
    return res.rows[0];
  },
};

// ── Tournaments ───────────────────────────────────────────────────────────
const tournaments = {
  async list(status) {
    let sql = 'SELECT * FROM tournaments';
    const params = [];
    if (status) {
      sql += ' WHERE status = $1';
      params.push(status);
    }
    sql += ' ORDER BY starts_at ASC';
    const res = await query(sql, params);
    return res.rows;
  },

  async findById(id) {
    const res = await query('SELECT * FROM tournaments WHERE id = $1', [id]);
    return res.rows[0];
  },

  async create(data) {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `INSERT INTO tournaments (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`;
    const res = await query(sql, values);
    return res.rows[0];
  },

  async getRegistrationCount(id) {
    const res = await query('SELECT COUNT(*) FROM tournament_registrations WHERE tournament_id = $1', [id]);
    return parseInt(res.rows[0].count);
  },

  async findRegistration(tournamentId, userId) {
    const res = await query('SELECT * FROM tournament_registrations WHERE tournament_id = $1 AND user_id = $2', [tournamentId, userId]);
    return res.rows[0];
  },

  async registerPlayer(data) {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `INSERT INTO tournament_registrations (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`;
    const res = await query(sql, values);
    return res.rows[0];
  },

  async getPlayers(id) {
    const sql = `
      SELECT tr.*, u.username, u.elo, u.avatar_url, u.title, u.country
      FROM tournament_registrations tr
      JOIN users u ON tr.user_id = u.id
      WHERE tr.tournament_id = $1
      ORDER BY tr.score DESC
    `;
    const res = await query(sql, [id]);
    return res.rows;
  },
};

// ── Collusion Flags ───────────────────────────────────────────────────────
const collusionFlags = {
  async create(data) {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `INSERT INTO collusion_flags (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`;
    const res = await query(sql, values);
    return res.rows[0];
  },
};

// ── Multi-Account Flags ───────────────────────────────────────────────────
const multiAccountFlags = {
  async create(data) {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `INSERT INTO multi_account_flags (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`;
    const res = await query(sql, values);
    return res.rows[0];
  },
};

module.exports = { 
  query, 
  users, 
  wallets, 
  transactions, 
  games, 
  notifications, 
  eloHistory, 
  appeals, 
  collusionFlags, 
  multiAccountFlags,
  tournaments
};
