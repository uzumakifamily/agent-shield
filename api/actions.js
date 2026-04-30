'use strict';
/**
 * api/actions.js
 *   GET  /api/actions — paginated action history for dashboard
 *   POST /api/actions — submit a new agent action through the Shield kernel
 *
 * POST body:
 *   { action_type, payload?, context?: { agent?, source?, project_id? } }
 *
 * Response:
 *   { verdict, risk_score, rule_matched, action_id, reason }
 */

const authenticate    = require('../middleware/auth');
const { getDb }       = require('../db');
const shield          = require('../brain/shield_kernel');

module.exports = async function (fastify, opts) {

  // ── GET /api/actions ─────────────────────────────────────────
  fastify.get('/', { preHandler: authenticate }, async (request, reply) => {
    const { workspace_id } = request.user;
    const db = getDb();

    try {
      const page        = Math.max(1, parseInt(request.query.page  ?? 1));
      const limit       = Math.min(100, Math.max(1, parseInt(request.query.limit ?? 10)));
      const offset      = (page - 1) * limit;
      const action_type = request.query.action_type || null;
      const status      = request.query.status      || null;
      const date_from   = request.query.date_from   || null;
      const date_to     = request.query.date_to     || null;
      const search      = request.query.search      || null;

      const conditions = ['workspace_id = ?'];
      const params     = [workspace_id];

      if (action_type) { conditions.push('action_type = ?');                        params.push(action_type); }
      if (status)      { conditions.push('status = ?');                              params.push(status);      }
      if (date_from)   { conditions.push("date(created_at) >= ?");                  params.push(date_from);   }
      if (date_to)     { conditions.push("date(created_at) <= ?");                  params.push(date_to);     }
      if (search)      {
        conditions.push('(id LIKE ? OR agent LIKE ? OR action_type LIKE ?)');
        const s = `%${search}%`;
        params.push(s, s, s);
      }

      const where = conditions.join(' AND ');
      const total = db.prepare(`SELECT COUNT(*) AS n FROM agent_actions WHERE ${where}`)
        .get(...params)?.n ?? 0;

      const rows = db.prepare(
        `SELECT id, workspace_id, project_id, agent, action_type, source,
                status, risk_score, hook_verdict, cost_tokens, cost_usd,
                authorized, note, created_at, resolved_at
           FROM agent_actions
          WHERE ${where}
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?`
      ).all(...params, limit, offset);

      return { rows, total, page, limit };
    } finally { db.close(); }
  });

  // ── POST /api/actions ─────────────────────────────────────────
  // Main SDK entry point — runs the agent action through the Shield kernel
  fastify.post('/', { preHandler: authenticate }, async (request, reply) => {
    const { workspace_id, id: userId, email } = request.user;
    const { action_type, payload, context = {} } = request.body || {};

    if (!action_type) {
      reply.code(400);
      return { error: 'action_type is required' };
    }

    const ctx = {
      workspaceId: workspace_id,
      projectId:   context.project_id || context.projectId || 'default',
      agent:       context.agent      || 'api-agent',
      actionType:  action_type,
      source:      context.source     || 'api',
      payload:     payload            || {},
    };

    // Run the before-hook (logs action, applies rules, scores risk)
    const result = await shield.before(ctx);

    // Look up the rule that matched for a human-readable label
    let rule_matched = null;
    if (result.action_id && result.verdict !== 'ALLOW') {
      const db = getDb();
      try {
        const action = db.prepare(
          'SELECT note FROM agent_actions WHERE id = ?'
        ).get(result.action_id);
        rule_matched = action?.note || result.reason || null;
      } finally { db.close(); }
    }

    return {
      verdict:      result.verdict,
      risk_score:   result.risk_score ?? 0,
      rule_matched: rule_matched || result.reason || null,
      action_id:    result.action_id,
      reason:       result.reason,
      proceed:      result.proceed,
      approval_id:  result.approval_id || null,
    };
  });
};
