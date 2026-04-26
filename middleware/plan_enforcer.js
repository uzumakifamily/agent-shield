'use strict';
/**
 * middleware/plan_enforcer.js — Fastify preHandler
 * Counts actions this month from SQLite.
 * Returns 402 if over limit (non-enterprise).
 * Attaches req.near_limit = true when at 80%+.
 */

const { getDb } = require('../db');

async function planEnforcer(request, reply) {
  const { workspace_id, plan_id, action_limit } = request.user;

  // Enterprise / unlimited: skip check
  if (plan_id === 'enterprise' || action_limit === -1) {
    request.actions_used_this_month = 0;
    request.near_limit = false;
    return;
  }

  const db = getDb();
  const row = db.prepare(
    `SELECT COUNT(*) AS count
       FROM agent_actions
      WHERE workspace_id = ?
        AND created_at >= strftime('%Y-%m-01', 'now')`
  ).get(workspace_id);

  const count = row?.count ?? 0;
  request.actions_used_this_month = count;
  request.near_limit = count >= action_limit * 0.8;

  if (count >= action_limit) {
    return reply.code(402).send({
      error:        'Action limit reached — upgrade your plan to continue',
      upgrade_url:  '/pricing',
      actions_used: count,
      action_limit,
    });
  }
}

module.exports = planEnforcer;
