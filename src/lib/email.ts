import nodemailer from 'nodemailer';
import logger from './logger';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const sendVerificationEmail = async (email: string, code: string) => {
  try {
    const info = await transporter.sendMail({
      from: `"Chess Arena" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Verification Code - Chess Arena',
      text: `Your verification code is: ${code}`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; color: #333;">
          <h2>Welcome to Chess Arena!</h2>
          <p>Please use the following 6-digit code to verify your account:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #2563eb; margin: 20px 0;">
            ${code}
          </div>
          <p>This code will expire in 10 minutes.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <small>If you didn't request this, please ignore this email.</small>
        </div>
      `,
    });
    logger.info(`[Email] Verification sent to ${email}: ${info.messageId}`);
    return true;
  } catch (err: any) {
    logger.error(`[Email] Failed to send to ${email}: ${err.message}`);
    return false;
  }
};
