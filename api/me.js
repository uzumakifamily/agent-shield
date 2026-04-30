'use strict';
/**
 * api/me.js — GET /api/me
 * Returns authenticated user, workspace, plan, action usage, and settings.
 * Uses SQLite only — no Supabase dependency.
 */

const authenticate = require('../middleware/auth');
const { getDb }    = require('../db');

const PLAN_NAMES = { free: 'Starter', starter: 'Starter', solo_starter: 'Starter', pro: 'Pro', enterprise: 'Enterprise' };

module.exports = async function (fastify, opts) {
  fastify.get('/', { preHandler: authenticate }, async (request, reply) => {
    const { id, email, workspace_id, plan_id, action_limit } = request.user;
    const db = getDb();

    try {
      // Action count this month
      const usageRow = db.prepare(
        `SELECT COUNT(*) AS count
           FROM agent_actions
          WHERE workspace_id = ?
            AND created_at >= strftime('%Y-%m-01', 'now')`
      ).get(workspace_id);
      const actions_used = usageRow?.count ?? 0;

      // Pending approvals count
      const pendingRow = db.prepare(
        `SELECT COUNT(*) AS count
           FROM approval_queue
          WHERE workspace_id = ?
            AND decision IS NULL`
      ).get(workspace_id);
      const pending_approvals = pendingRow?.count ?? 0;

      // Last 7 days action breakdown for chart
      const dailyStats = db.prepare(
        `SELECT date(created_at) AS day, hook_verdict, COUNT(*) AS count
           FROM agent_actions
          WHERE workspace_id = ?
            AND created_at >= date('now', '-7 days')
          GROUP BY day, hook_verdict
          ORDER BY day`
      ).all(workspace_id);

      // Settings from SQLite (table may not exist yet — return safe defaults)
      let settings = { dry_run: true, telegram_bot_token: null, telegram_chat_id: null };
      try {
        const row = db.prepare(
          `SELECT dry_run, telegram_bot_token, telegram_chat_id
             FROM user_settings
            WHERE workspace_id = ?`
        ).get(workspace_id);
        if (row) {
          settings = {
            dry_run:             row.dry_run !== 0,           // SQLite stores booleans as 0/1
            telegram_bot_token:  row.telegram_bot_token  ?? null,
            telegram_chat_id:    row.telegram_chat_id    ?? null,
          };
        }
      } catch {
        // user_settings table doesn't exist yet — harmless, return defaults
      }

      const near_limit = action_limit !== -1 && actions_used >= action_limit * 0.8;

      return {
        user:                    { id, email },
        workspace_id,
        plan_id,
        plan_name:               PLAN_NAMES[plan_id] ?? plan_id,
        action_limit,
        actions_used_this_month: actions_used,
        pending_approvals,
        near_limit,
        daily_stats:             dailyStats,
        settings,
      };
    } finally {
      db.close();
    }
  });
};
