/**
 * iPaymu Payment Gateway Integration
 *
 * Variabel yang dibutuhkan (tambahkan di env):
 *  - IPAYMU_VA: (Kosongkan dulu)
 *  - IPAYMU_API_KEY: (Kosongkan dulu)
 *  - IPAYMU_URL: https://my.ipaymu.com/api/v2/payment (Production)
 */

import axios from 'axios';
import crypto from 'crypto';

const IPAYMU_VA = process.env.IPAYMU_VA || '';
const IPAYMU_API_KEY = process.env.IPAYMU_API_KEY || '';
const IPAYMU_URL = process.env.IPAYMU_URL || 'https://my.ipaymu.com/api/v2/payment';

export const PLATFORM_FEE_PCT = 0.04; // 4% commission

/**
 * Signature helper untuk iPaymu v2
 */
function generateSignature(body: any, method = 'POST') {
  const bodyHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(body))
    .digest('hex')
    .toLowerCase();
  const stringToSign = `${method}:${IPAYMU_VA}:${bodyHash}:${IPAYMU_API_KEY}`;
  return crypto
    .createHmac('sha256', IPAYMU_API_KEY)
    .update(stringToSign)
    .digest('hex')
    .toLowerCase();
}

/**
 * Membuat transaksi pembayaran (Redirect Payment)
 */
export async function createDepositTransaction({
  userId: _userId,
  username,
  email,
  amount,
}: {
  userId: string;
  username: string;
  email: string;
  amount: number;
}) {
  const orderId = `DEP-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

  const body = {
    name: username,
    email: email,
    phoneNumber: '08123456789', // Placeholder
    amount: amount,
    notifyUrl: `${process.env.BACKEND_URL}/api/webhook/ipaymu`,
    returnUrl: `${process.env.FRONTEND_URL}/wallet?status=success`,
    cancelUrl: `${process.env.FRONTEND_URL}/wallet?status=cancel`,
    referenceId: orderId,
    product: ['Deposit Saldo Chess Arena'],
    qty: [1],
    price: [amount],
  };

  try {
    // Jika API Key kosong, kita kemulasikan sukses untuk mempermudah development
    if (!IPAYMU_API_KEY || !IPAYMU_VA) {
      console.warn('[iPaymu] API Key atau VA belum diset. Menggunakan mode simulasi.');
      return {
        sessionId: 'sim-session-' + orderId,
        url: `${process.env.FRONTEND_URL}/wallet/simulate?orderId=${orderId}`,
        orderId,
      };
    }

    const signature = generateSignature(body);
    const response = await axios.post(IPAYMU_URL, body, {
      headers: {
        'Content-Type': 'application/json',
        va: IPAYMU_VA,
        signature: signature,
      },
    });

    if (response.data && response.data.status === 200) {
      return {
        sessionId: response.data.data.sessionId,
        url: response.data.data.url,
        orderId: orderId,
      };
    } else {
      throw new Error(response.data.message || 'Gagal membuat transaksi iPaymu');
    }
  } catch (error: any) {
    console.error('[iPaymu] Error:', error.response?.data || error.message);
    throw error;
  }
}

export function calculateFee(amount: number) {
  return Math.round(amount * PLATFORM_FEE_PCT);
}

export function netWinnings(stakes: number) {
  const fee = calculateFee(stakes);
  return { gross: stakes, fee, net: stakes - fee };
}
