'use strict';
/**
 * api/me.js — GET /api/me
 * Returns authenticated user, workspace, plan, action usage, and settings.
 */

const authenticate = require('../middleware/auth');
const { supabaseAdmin } = require('../services/supabase');
const { getDb } = require('../db');

const PLAN_NAMES = { free: 'Starter', pro: 'Pro', enterprise: 'Enterprise' };

module.exports = async function (fastify, opts) {
  fastify.get('/', { preHandler: authenticate }, async (request, reply) => {
    const { id, email, workspace_id, plan_id, action_limit } = request.user;
    const db = getDb();

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

    // Settings
    const { data: settings } = await supabaseAdmin
      .from('user_settings')
      .select('dry_run, telegram_bot_token, telegram_chat_id')
      .eq('workspace_id', workspace_id)
      .single();

    const near_limit = action_limit !== -1 && actions_used >= action_limit * 0.8;

    return {
      user:                   { id, email },
      workspace_id,
      plan_id,
      plan_name:              PLAN_NAMES[plan_id] ?? plan_id,
      action_limit,
      actions_used_this_month: actions_used,
      pending_approvals,
      near_limit,
      daily_stats:            dailyStats,
      settings: {
        dry_run:              settings?.dry_run             ?? true,
        telegram_bot_token:   settings?.telegram_bot_token  ?? null,
        telegram_chat_id:     settings?.telegram_chat_id    ?? null,
      },
    };
  });
};
