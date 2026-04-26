'use strict';
/**
 * api/actions.js — GET /api/actions
 * Returns paginated agent_actions from SQLite for the authenticated workspace.
 */

const authenticate   = require('../middleware/auth');
const { getDb }      = require('../db');

module.exports = async function (fastify, opts) {
  fastify.get('/', { preHandler: authenticate }, async (request, reply) => {
    const { workspace_id } = request.user;
    const db = getDb();

    const page        = Math.max(1, parseInt(request.query.page  ?? 1));
    const limit       = Math.min(100, Math.max(1, parseInt(request.query.limit ?? 10)));
    const offset      = (page - 1) * limit;
    const action_type = request.query.action_type || null;
    const status      = request.query.status      || null;
    const date_from   = request.query.date_from   || null;
    const date_to     = request.query.date_to     || null;
    const search      = request.query.search      || null;

    // Build dynamic WHERE clauses
    const conditions = ['workspace_id = ?'];
    const params     = [workspace_id];

    if (action_type) { conditions.push('action_type = ?');            params.push(action_type); }
    if (status)      { conditions.push('status = ?');                  params.push(status);      }
    if (date_from)   { conditions.push("date(created_at) >= ?");       params.push(date_from);   }
    if (date_to)     { conditions.push("date(created_at) <= ?");       params.push(date_to);     }
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
  });
};
