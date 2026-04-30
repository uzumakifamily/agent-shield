'use strict';
/**
 * utils/notify.js — Telegram approval notifications
 *
 * Per-workspace Telegram config is read from user_settings in SQLite.
 * Falls back to TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID env vars if
 * workspace settings are not configured.
 */

const https = require('https');

function postJSON(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req  = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => { try { resolve(JSON.parse(chunks)); } catch { resolve({}); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Get Telegram config for a workspace.
 * Priority: workspace DB settings → process.env
 */
function getTelegramConfig(workspaceId) {
  if (workspaceId) {
    try {
      const { getDb } = require('../db');
      const db  = getDb();
      const row = db.prepare(
        'SELECT telegram_bot_token, telegram_chat_id FROM user_settings WHERE workspace_id = ?'
      ).get(workspaceId);
      db.close();
      if (row?.telegram_bot_token && row?.telegram_chat_id) {
        return { token: row.telegram_bot_token, chatId: row.telegram_chat_id };
      }
    } catch {
      // DB not available — fall through to env vars
    }
  }

  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (token && chatId) return { token, chatId };

  return null;
}

/**
 * Send a Telegram notification for a pending approval.
 * Returns the Telegram message_id on success, or null on failure/no-config.
 */
async function notifyApproval({ approvalId, actionId, agent, actionType, reason, workspaceId }) {
  const config = getTelegramConfig(workspaceId);
  if (!config) return null;

  try {
    const res = await postJSON(
      `https://api.telegram.org/bot${config.token}/sendMessage`,
      {
        chat_id:    config.chatId,
        parse_mode: 'HTML',
        text: [
          '<b>⚠️ Approval Required</b>',
          '',
          `<b>Agent:</b> ${agent || 'unknown'}`,
          `<b>Action:</b> ${actionType}`,
          `<b>Reason:</b> ${reason || 'Risk threshold exceeded'}`,
          '',
          `Approval ID: <code>${approvalId}</code>`,
          `/approve_${approvalId}`,
          `/deny_${approvalId}`,
        ].join('\n'),
      }
    );
    return res.result?.message_id || null;
  } catch (err) {
    console.warn('[notify] Telegram send failed:', err.message);
    return null;
  }
}

module.exports = { notifyApproval, getTelegramConfig };
