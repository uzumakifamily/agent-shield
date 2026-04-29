'use strict';
/**
 * utils/email.js — SMTP email helper for OTP verification
 * Uses nodemailer with env-based SMTP config
 */

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host:   process.env.EMAIL_HOST,
  port:   parseInt(process.env.EMAIL_PORT || '587', 10),
  secure: process.env.EMAIL_PORT === '465',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/**
 * Send OTP verification email
 * @param {string} to — recipient email
 * @param {string} otp — 6-digit code
 */
async function sendOtpEmail(to, otp) {
  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'noreply@agentshield.dev';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0b0d; color: #f1f5f9; margin: 0; padding: 40px 20px; }
    .wrap { max-width: 480px; margin: 0 auto; background: #111318; border: 1px solid rgba(255,255,255,0.07); border-radius: 16px; padding: 36px; }
    .logo { font-weight: 800; font-size: 1.2rem; margin-bottom: 24px; }
    .logo span { color: #00909a; }
    h2 { font-size: 1.3rem; margin: 0 0 12px; }
    p  { color: #94a3b8; line-height: 1.6; margin: 0 0 24px; }
    .otp { background: rgba(0,144,154,0.1); border: 1px solid rgba(0,144,154,0.3); border-radius: 10px; padding: 20px; text-align: center; margin: 24px 0; }
    .otp-code { font-family: 'SF Mono', monospace; font-size: 2rem; font-weight: 700; color: #00909a; letter-spacing: 0.15em; }
    .otp-label { font-size: 0.8rem; color: #64748b; margin-top: 8px; }
    .footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.07); font-size: 0.8rem; color: #64748b; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="logo">AgentShield<span>.</span></div>
    <h2>Verify your email</h2>
    <p>Thanks for signing up. Use the code below to verify your email address. It expires in 10 minutes.</p>
    <div class="otp">
      <div class="otp-code">${otp}</div>
      <div class="otp-label">Expires in 10 minutes</div>
    </div>
    <p style="font-size:0.85rem">If you didn't request this, you can safely ignore this email.</p>
    <div class="footer">
      AgentShield — Trust layer for AI agents<br>
      <a href="mailto:${from}" style="color:#64748b">${from}</a>
    </div>
  </div>
</body>
</html>`;

  const info = await transporter.sendMail({
    from:    `"AgentShield" <${from}>`,
    to,
    subject: 'Your Agent Shield verification code',
    text:    `Your Agent Shield verification code is: ${otp}\n\nIt expires in 10 minutes.\n\nIf you didn't request this, you can safely ignore this email.`,
    html,
  });

  return info;
}

module.exports = { sendOtpEmail };
