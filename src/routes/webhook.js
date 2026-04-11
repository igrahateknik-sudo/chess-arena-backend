const { Router } = require('express');
const router = Router();
const { wallets, transactions } = require('../lib/db');

/**
 * POST /api/webhook/ipaymu
 * iPaymu sends payment notifications here.
 * Format iPaymu v2 (HTTP POST)
 */
router.post('/ipaymu', async (req, res) => {
  try {
    const {
      status,
      reference_id,
      trx_id,
      sid,
      status_code,
    } = req.body;

    console.log(`[webhook/ipaymu] order=${reference_id} status=${status} trx_id=${trx_id}`);

    // Find our transaction record
    // Kita simpan orderId iPaymu di kolom midtrans_order_id (legacy naming)
    const tx = await transactions.findByOrderId(reference_id);
    if (!tx) {
      console.warn('[webhook/ipaymu] Transaction not found:', reference_id);
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Idempotency
    if (tx.status === 'completed') {
      return res.json({ ok: true, message: 'Already processed' });
    }

    // iPaymu status 'berhasil' atau status_code 1 (Success)
    if (status === 'berhasil' || status_code === '1') {
      // Credit uses atomic DB function
      const wallet = await wallets.credit(tx.user_id, tx.amount);

      await transactions.update(tx.id, {
        status: 'completed',
        balance_after: wallet?.balance,
        midtrans_raw: JSON.stringify(req.body), // Simpan log asli
      });

      console.log(`[webhook/ipaymu] ✅ Credited ${tx.amount} to user ${tx.user_id} (order: ${reference_id})`);
    } else if (['pending', 'pending_pembayaran'].includes(status)) {
      await transactions.update(tx.id, {
        status: 'pending',
        midtrans_raw: JSON.stringify(req.body),
      });
    } else {
      await transactions.update(tx.id, {
        status: 'failed',
        midtrans_raw: JSON.stringify(req.body),
      });
    }

    // iPaymu butuh response JSON ok
    res.json({ status: 200, message: 'OK' });
  } catch (err) {
    console.error('[webhook/ipaymu] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
