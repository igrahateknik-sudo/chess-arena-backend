import express, { Request, Response } from 'express';
import { transactions } from '../lib/db';
import prisma from '../lib/prisma';

const router = express.Router();

/**
 * iPaymu Webhook — Dibayar oleh iPaymu saat transaksi selesai
 */
router.post('/ipaymu', async (req: Request, res: Response) => {
  try {
    const { status, reference_id, trx_id, status_code } = req.body;

    console.log(`[webhook/ipaymu] order=${reference_id} status=${status} trx_id=${trx_id}`);

    const tx = await transactions.findByOrderId(reference_id as string);
    if (!tx) {
      console.warn('[webhook/ipaymu] Transaction not found:', reference_id);
      return res.status(404).json({ error: 'Transaction not found' });
    }

    if (tx.status === 'completed') {
      return res.json({ ok: true, message: 'Already processed' });
    }

    if (status === 'berhasil' || status_code === '1') {
      await prisma.$transaction(async (txClient) => {
        await txClient.transaction.update({
          where: { id: tx.id },
          data: {
            status: 'completed',
            midtrans_raw: req.body, // Simpan raw data dari iPaymu
            updated_at: new Date(),
          },
        });

        // Kreditkan saldo dompet menggunakan fungsi yang sudah ada (BigInt amount)
        await txClient.$queryRaw`SELECT credit_wallet(${tx.user_id}::uuid, ${tx.amount})`;
      });

      console.log(`[webhook/ipaymu] Success: Credited ${tx.amount} to user ${tx.user_id}`);
      res.json({ ok: true });
    } else {
      console.log(`[webhook/ipaymu] Payment status: ${status}. No action taken.`);
      res.json({ ok: true, message: 'Not a success status' });
    }
  } catch (err) {
    console.error('[webhook/ipaymu/error]', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
