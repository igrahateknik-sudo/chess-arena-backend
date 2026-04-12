import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: (process.env.SMTP_PORT === '465' || process.env.SMTP_SECURE === 'true'),
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  debug: true, // AKTIFKAN DEBUG
  logger: true // LOG SEMUA KOMUNIKASI SMTP
});

async function test() {
  console.log('--- Memulai Tes Koneksi SMTP ---');
  console.log(`User: ${process.env.SMTP_USER}`);
  console.log(`Host: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT}`);

  try {
    // 1. Verifikasi Koneksi
    await transporter.verify();
    console.log('✅ Koneksi SMTP Berhasil Diverifikasi!');

    // 2. Coba Kirim Email
    const info = await transporter.sendMail({
      from: `"Test Chess" <${process.env.SMTP_USER}>`,
      to: process.env.SMTP_USER as string, // Kirim ke diri sendiri
      subject: 'Tes Koneksi SMTP Chess Arena',
      text: 'Hore! Kalau Anda baca ini, berarti SMTP sudah benar-benar jalan.',
    });

    console.log('✅ Email Terkirim!');
    console.log('Message ID:', info.messageId);
  } catch (err: any) {
    console.error('❌ TES GAGAL!');
    console.error('Pesan Error:', err.message);
    if (err.response) {
      console.error('Respon Server SMTP:', err.response);
    }
  }
}

test();
