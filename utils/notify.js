'use strict';
/**
 * utils/notify.js — Telegram approval notifications
 * Uses built-in https to avoid extra dependencies.
 */

const https = require('https');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function postJSON(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => {
        try { resolve(JSON.parse(chunks)); } catch { resolve({}); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function notifyApproval({ approvalId, actionId, agent, actionType, reason }) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return null;

  try {
    const res = await postJSON(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      {
        chat_id: TELEGRAM_CHAT_ID,
        text: `Approval Required\n\nAgent: ${agent}\nAction: ${actionType}\nReason: ${reason}\n\nApprove: /approve_${approvalId}\nDeny: /deny_${approvalId}`,
      }
    );
    return res.result?.message_id || null;
  } catch (err) {
    console.warn('[notify] Telegram send failed:', err.message);
    return null;
  }
}

module.exports = { notifyApproval };
