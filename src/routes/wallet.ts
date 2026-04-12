import express, { Response } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { wallets, transactions } from '../lib/db';
import { createDepositTransaction, calculateFee } from '../lib/ipaymu';

const router = express.Router();

// ── Rate Limiters ───────────────────────────────────────────────────────────
const depositRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5,
  validate: { default: false },
  keyGenerator: (req: any) => req.userId || req.ip,
  handler: (_req, res) => {
    res.status(429).json({ error: 'Too many deposit requests. Please wait 10 minutes.' });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const withdrawRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  validate: { default: false },
  keyGenerator: (req: any) => req.userId || req.ip,
  handler: (_req, res) => {
    res.status(429).json({ error: 'Too many withdrawal requests. Please wait 1 hour.' });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── GET /api/wallet/balance ──────────────────────────────────────────────────
router.get('/balance', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const wallet = await wallets.getBalance(userId);
    res.json({
      balance: (wallet.balance || 0n).toString(),
      locked: (wallet.locked || 0n).toString(),
    });
  } catch (err) {
    console.error('[wallet/balance]', err);
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
});

// ── POST /api/wallet/deposit ─────────────────────────────────────────────────
router.post('/deposit', requireAuth, depositRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const { amount } = req.body;
    const userId = req.userId!;
    const user = req.user!;

    if (!amount || amount < 10000) {
      return res.status(400).json({ error: 'Minimum deposit is Rp 10,000' });
    }

    const tx = await createDepositTransaction({
      userId,
      username: user.username,
      email: user.email,
      amount: parseInt(amount),
    });

    // SIMPAN TRANSAKSI KE DATABASE (Penting agar webhook bisa memprosesnya nanti)
    await transactions.create({
      user_id: userId,
      amount: BigInt(amount),
      type: 'deposit',
      status: 'pending',
      description: `Deposit via iPaymu (Order: ${tx.orderId})`,
      midtrans_order_id: tx.orderId, // Menggunakan field ini sementara sesuai mapping di db.ts
    });

    res.json({ checkoutUrl: tx.url, orderId: tx.orderId });
  } catch (err) {
    console.error('[wallet/deposit]', err);
    res.status(500).json({ error: 'Failed to initiate deposit' });
  }
});

// ── POST /api/wallet/withdraw ────────────────────────────────────────────────
router.post(
  '/withdraw',
  requireAuth,
  withdrawRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const { amount, bankName, accountName, accountNumber } = req.body;
      const userId = req.userId!;

      if (!amount || !bankName || !accountName || !accountNumber) {
        return res.status(400).json({ error: 'All fields are required' });
      }

      if (amount < 50000) {
        return res.status(400).json({ error: 'Minimum withdrawal is Rp 50,000' });
      }

      // Check balance
      const wallet = await wallets.getBalance(userId);
      const balance = wallet.balance || 0n;
      const locked = wallet.locked || 0n;
      const available = balance - locked;

      if (available < BigInt(amount)) {
        return res.status(400).json({ error: 'Insufficient balance' });
      }

      const fee = calculateFee(amount);
      const totalDebit = BigInt(amount) + BigInt(fee);

      if (available < totalDebit) {
        return res
          .status(400)
          .json({ error: `Insufficient balance to cover fee (Total: ${totalDebit})` });
      }

      // Create withdrawal transaction (locked)
      await transactions.create({
        user_id: userId,
        amount: -BigInt(amount),
        type: 'withdraw',
        status: 'pending',
        description: `Withdrawal to ${bankName} (${accountNumber})`,
      });

      // Lock the balance
      await wallets.lock(userId, totalDebit);

      res.json({ ok: true, message: 'Withdrawal request submitted' });
    } catch (err) {
      console.error('[wallet/withdraw]', err);
      res.status(500).json({ error: 'Failed to create withdrawal request' });
    }
  },
);

export default router;
