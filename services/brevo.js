'use strict';
/**
 * services/brevo.js — Transactional receipt emails via Brevo REST API
 * Reuses BREVO_API_KEY already in .env
 */

const BREVO_API = 'https://api.brevo.com/v3/smtp/email';

/**
 * sendReceipt({ email, name, plan_name, amount, currency, payment_id })
 */
async function sendReceipt({ email, name, plan_name, amount, currency, payment_id }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.warn('[brevo] BREVO_API_KEY not set — skipping receipt email');
    return { skipped: true };
  }

  const subject = `Your Agent Shield ${plan_name} subscription is active`;

  const htmlBody = `
<!DOCTYPE html>
<html>
<body style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#2c2b29">
  <div style="margin-bottom:24px">
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 2L4 7v9c0 7 5.4 13.6 12 15 6.6-1.4 12-8 12-15V7L16 2z"
            fill="rgba(1,105,111,.15)" stroke="#01696f" stroke-width="1.5"/>
      <path d="M11 16l3 3 7-7" stroke="#01696f" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span style="font-weight:700;font-size:1.1rem;vertical-align:middle;margin-left:8px">Agent Shield</span>
  </div>

  <h2 style="font-size:1.5rem;margin-bottom:8px">Subscription confirmed</h2>
  <p style="color:#6b6a68;margin-bottom:24px">Hi ${escapeHtml(name)}, your <strong>${escapeHtml(plan_name)}</strong> plan is now active.</p>

  <div style="background:#f5f4f0;border-radius:10px;padding:20px;margin-bottom:24px">
    <div style="display:flex;justify-content:space-between;margin-bottom:8px">
      <span style="color:#6b6a68;font-size:.875rem">Plan</span>
      <span style="font-weight:600">${escapeHtml(plan_name)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:8px">
      <span style="color:#6b6a68;font-size:.875rem">Amount paid</span>
      <span style="font-weight:600">${escapeHtml(amount)} ${escapeHtml(currency)}</span>
    </div>
    <div style="display:flex;justify-content:space-between">
      <span style="color:#6b6a68;font-size:.875rem">Payment ID</span>
      <span style="font-family:monospace;font-size:.8125rem">${escapeHtml(payment_id)}</span>
    </div>
  </div>

  <p style="color:#6b6a68;font-size:.875rem;margin-bottom:8px">
    Keep this email for your records. Need help? Reply to this email or reach us at
    <a href="mailto:manager@allkinz.com" style="color:#01696f">manager@allkinz.com</a>.
  </p>
  <p style="color:#6b6a68;font-size:.875rem">— The Agent Shield team</p>
</body>
</html>`;

  const res = await fetch(BREVO_API, {
    method:  'POST',
    headers: {
      'api-key':      apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender:   { name: 'Agent Shield', email: process.env.EMAIL_FROM || 'manager@allkinz.com' },
      to:       [{ email, name }],
      subject,
      htmlContent: htmlBody,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Brevo send failed (${res.status}): ${err}`);
  }

  return { ok: true };
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { sendReceipt };
