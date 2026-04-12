import nodemailer from 'nodemailer';
import logger from './logger';

// TRANSPORTER DENGAN DEBUG AKTIF
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: (process.env.SMTP_PORT === '465' || process.env.SMTP_SECURE === 'true'),
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  debug: true, // AKTIFKAN DEBUG UNTUK MELIHAT RESPON SERVER
  logger: true, // LOG KOMUNIKASI SMTP KE CONSOLE
  tls: {
    rejectUnauthorized: process.env.NODE_ENV === 'production',
  },
});

export const sendVerificationEmail = async (email: string, token: string) => {
  try {
    const appUrl = process.env.APP_URL || 'http://localhost:8080';
    // Link mengarah ke Backend endpoint yang baru saya buat
    const verificationLink = `${appUrl}/api/auth/verify-link?token=${token}`;
    const displayCode = token.substring(0, 6).toUpperCase();

    logger.info(`[Email] Attempting to send verification to ${email} via ${process.env.SMTP_USER}`);

    const info = await transporter.sendMail({
      // PENTING: From harus sama dengan user AUTH agar tidak diblokir Gmail
      from: `"Chess Arena" <${process.env.SMTP_USER}>`,
      to: email,
      subject: `[${displayCode}] Kode Verifikasi Chess Arena`,
      text: `Welcome! Your code is: ${displayCode}. Link: ${verificationLink}`,
      html: `
        <div style="font-family: sans-serif; padding: 30px; border: 1px solid #eee; border-radius: 12px; max-width: 500px; margin: 0 auto;">
          <h2 style="color: #2563eb; text-align: center;">Chess Arena</h2>
          <p>Gunakan kode di bawah ini untuk verifikasi akun kamu:</p>
          <div style="background: #f1f5f9; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #2563eb; border-radius: 8px; margin: 20px 0;">
            ${displayCode}
          </div>
          <p style="text-align: center;">Atau klik tombol ini:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verificationLink}" style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Verifikasi Sekarang</a>
          </div>
          <p style="font-size: 12px; color: #64748b; text-align: center;">Link & Kode berlaku 24 jam.</p>
        </div>
      `,
    });
    
    logger.info(`[Email] SUCCESS! MessageId: ${info.messageId}`);
    return true;
  } catch (err: any) {
    logger.error(`[Email] FAILED: ${err.message}`);
    // Log detail error SMTP jika ada
    if (err.response) logger.error(`[Email] SMTP Response: ${err.response}`);
    return false;
  }
};

export const sendResetPasswordEmail = async (email: string, token: string) => {
  try {
    const appUrl = process.env.APP_URL || 'http://localhost:8080';
    const resetLink = `${appUrl}/reset-password?token=${token}`;

    await transporter.sendMail({
      from: `"Chess Arena" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Reset Password Chess Arena',
      text: `Reset link: ${resetLink}`,
      html: `<p>Klik <a href="${resetLink}">di sini</a> untuk reset password.</p>`,
    });
    return true;
  } catch (err: any) {
    logger.error(`[Email] Reset FAILED: ${err.message}`);
    return false;
  }
};
