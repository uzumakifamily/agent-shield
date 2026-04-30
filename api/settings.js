'use strict';
/**
 * api/settings.js
 *   GET  /api/settings — read user_settings from SQLite
 *   POST /api/settings — upsert user_settings in SQLite; also updates process.env at runtime
 *
 * Uses SQLite only — no Supabase dependency.
 */

const authenticate = require('../middleware/auth');
const { getDb }    = require('../db');

module.exports = async function (fastify, opts) {
  // ── GET /api/settings ────────────────────────────────────────
  fastify.get('/', { preHandler: authenticate }, async (request, reply) => {
    const { workspace_id } = request.user;
    const db = getDb();

    try {
      let row = null;
      try {
        row = db.prepare(
          `SELECT dry_run, telegram_bot_token, telegram_chat_id, updated_at
             FROM user_settings
            WHERE workspace_id = ?`
        ).get(workspace_id);
      } catch {
        // Table doesn't exist yet — return defaults
      }

      return {
        dry_run:            row ? row.dry_run !== 0 : true,
        telegram_bot_token: row?.telegram_bot_token  ?? null,
        telegram_chat_id:   row?.telegram_chat_id    ?? null,
        updated_at:         row?.updated_at          ?? null,
      };
    } finally {
      db.close();
    }
  });

  // ── POST /api/settings ───────────────────────────────────────
  fastify.post('/', { preHandler: authenticate }, async (request, reply) => {
    const { workspace_id } = request.user;
    const { dry_run, telegram_bot_token, telegram_chat_id } = request.body || {};

    const db = getDb();
    try {
      // Ensure table exists
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_settings (
          workspace_id        TEXT PRIMARY KEY,
          dry_run             INTEGER NOT NULL DEFAULT 1,
          telegram_bot_token  TEXT,
          telegram_chat_id    TEXT,
          updated_at          TEXT
        )
      `);

      // Fetch current row (for merge)
      const current = db.prepare(
        `SELECT dry_run, telegram_bot_token, telegram_chat_id FROM user_settings WHERE workspace_id = ?`
      ).get(workspace_id);

      const newDryRun  = dry_run            !== undefined ? (dry_run ? 1 : 0)          : (current?.dry_run ?? 1);
      const newTgToken = telegram_bot_token !== undefined ? (telegram_bot_token || null) : (current?.telegram_bot_token ?? null);
      const newTgChat  = telegram_chat_id   !== undefined ? (telegram_chat_id   || null) : (current?.telegram_chat_id   ?? null);
      const now        = new Date().toISOString();

      db.prepare(`
        INSERT INTO user_settings (workspace_id, dry_run, telegram_bot_token, telegram_chat_id, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id) DO UPDATE SET
          dry_run             = excluded.dry_run,
          telegram_bot_token  = excluded.telegram_bot_token,
          telegram_chat_id    = excluded.telegram_chat_id,
          updated_at          = excluded.updated_at
      `).run(workspace_id, newDryRun, newTgToken, newTgChat, now);

      // Propagate dry_run to the running process so shield.run() picks it up immediately
      if (dry_run !== undefined) {
        process.env.SHIELD_DRY_RUN = dry_run ? 'true' : 'false';
      }

      return { ok: true };
    } catch (err) {
      request.log.error(err, 'Failed to save settings');
      reply.code(500);
      return { error: 'Failed to save settings' };
    } finally {
      db.close();
    }
  });
};
