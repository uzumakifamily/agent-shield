'use strict';
/**
 * api/settings.js
 *   GET  /api/settings — read workspace settings from SQLite
 *   POST /api/settings — upsert workspace settings
 *
 * Returns api_key (lazily generated once per workspace).
 * Uses SQLite only — no Supabase dependency.
 */

const authenticate       = require('../middleware/auth');
const { getDb }          = require('../db');
const { makeApiKey }     = require('../utils/jwt');

function ensureSettingsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_settings (
      workspace_id        TEXT PRIMARY KEY,
      dry_run             INTEGER NOT NULL DEFAULT 1,
      telegram_bot_token  TEXT,
      telegram_chat_id    TEXT,
      risk_threshold      REAL    DEFAULT 0.75,
      api_key             TEXT,
      updated_at          TEXT
    )
  `);

  // Idempotent column additions for existing DBs
  const cols = db.prepare('PRAGMA table_info(user_settings)').all().map(c => c.name);
  if (!cols.includes('risk_threshold'))
    db.exec('ALTER TABLE user_settings ADD COLUMN risk_threshold REAL DEFAULT 0.75');
  if (!cols.includes('api_key'))
    db.exec('ALTER TABLE user_settings ADD COLUMN api_key TEXT');
}

function getOrCreateApiKey(db, workspace_id, user_id, email, plan) {
  const row = db.prepare('SELECT api_key FROM user_settings WHERE workspace_id = ?').get(workspace_id);
  if (row?.api_key) return row.api_key;

  // Generate a new 100-year API key
  const key = makeApiKey({ sub: user_id, email, workspace: workspace_id, plan: plan || 'free' });

  // Upsert with the new key
  db.prepare(`
    INSERT INTO user_settings (workspace_id, api_key, dry_run, updated_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET api_key = excluded.api_key, updated_at = excluded.updated_at
  `).run(workspace_id, key, new Date().toISOString());

  return key;
}

module.exports = async function (fastify, opts) {
  // ── GET /api/settings ────────────────────────────────────────
  fastify.get('/', { preHandler: authenticate }, async (request, reply) => {
    const { workspace_id, id: user_id, email, plan_id } = request.user;
    const db = getDb();

    try {
      ensureSettingsTable(db);

      let row = db.prepare(
        `SELECT dry_run, telegram_bot_token, telegram_chat_id, risk_threshold, api_key, updated_at
           FROM user_settings
          WHERE workspace_id = ?`
      ).get(workspace_id);

      // Lazily generate API key if missing
      const apiKey = (row?.api_key) || getOrCreateApiKey(db, workspace_id, user_id, email, plan_id);

      return {
        dry_run:            row ? row.dry_run !== 0 : true,
        telegram_bot_token: row?.telegram_bot_token ?? null,
        telegram_chat_id:   row?.telegram_chat_id   ?? null,
        risk_threshold:     row?.risk_threshold      ?? 0.75,
        api_key:            apiKey,
        updated_at:         row?.updated_at          ?? null,
      };
    } finally { db.close(); }
  });

  // ── POST /api/settings ───────────────────────────────────────
  fastify.post('/', { preHandler: authenticate }, async (request, reply) => {
    const { workspace_id, id: user_id, email, plan_id } = request.user;
    const { dry_run, telegram_bot_token, telegram_chat_id, risk_threshold } = request.body || {};

    const db = getDb();
    try {
      ensureSettingsTable(db);

      // Fetch current row to merge
      const current = db.prepare(
        `SELECT dry_run, telegram_bot_token, telegram_chat_id, risk_threshold, api_key
           FROM user_settings WHERE workspace_id = ?`
      ).get(workspace_id);

      // Ensure API key exists
      const apiKey = current?.api_key || getOrCreateApiKey(db, workspace_id, user_id, email, plan_id);

      const newDryRun   = dry_run            !== undefined ? (dry_run ? 1 : 0)          : (current?.dry_run          ?? 1);
      const newTgToken  = telegram_bot_token !== undefined ? (telegram_bot_token || null) : (current?.telegram_bot_token ?? null);
      const newTgChat   = telegram_chat_id   !== undefined ? (telegram_chat_id   || null) : (current?.telegram_chat_id   ?? null);
      const newRiskThr  = risk_threshold     !== undefined ? (parseFloat(risk_threshold) || 0.75) : (current?.risk_threshold ?? 0.75);
      const now         = new Date().toISOString();

      db.prepare(`
        INSERT INTO user_settings
          (workspace_id, dry_run, telegram_bot_token, telegram_chat_id, risk_threshold, api_key, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id) DO UPDATE SET
          dry_run             = excluded.dry_run,
          telegram_bot_token  = excluded.telegram_bot_token,
          telegram_chat_id    = excluded.telegram_chat_id,
          risk_threshold      = excluded.risk_threshold,
          api_key             = excluded.api_key,
          updated_at          = excluded.updated_at
      `).run(workspace_id, newDryRun, newTgToken, newTgChat, newRiskThr, apiKey, now);

      // Propagate dry_run to running process
      if (dry_run !== undefined) {
        process.env.SHIELD_DRY_RUN = dry_run ? 'true' : 'false';
      }

      return { ok: true, api_key: apiKey };
    } catch (err) {
      request.log.error(err, 'Failed to save settings');
      reply.code(500);
      return { error: 'Failed to save settings' };
    } finally { db.close(); }
  });
};
