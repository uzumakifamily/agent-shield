'use strict';
/**
 * api/approvals_api.js — Authenticated /api/approvals routes
 * Wraps the same logic as api/approvals.js but adds JWT auth.
 * Original api/approvals.js is untouched (legacy /approvals path still works).
 */

const authenticate                = require('../middleware/auth');
const { resolveApproval }         = require('../brain/shield_kernel');
const { getDb }                   = require('../db');

module.exports = async function (fastify, opts) {
  // GET /api/approvals — pending items for this workspace
  fastify.get('/', { preHandler: authenticate }, async (request, reply) => {
    const { workspace_id } = request.user;
    const db  = getDb();
    const rows = db.prepare(
      `SELECT aq.id, aq.action_id, aq.reason, aq.created_at,
              aa.action_type, aa.risk_score, aa.agent
         FROM approval_queue aq
         JOIN agent_actions  aa ON aa.id = aq.action_id
        WHERE aq.workspace_id = ?
          AND aq.decision IS NULL
        ORDER BY aq.created_at DESC`
    ).all(workspace_id);
    return { rows, total: rows.length };
  });

  // POST /api/approvals/:id/resolve
  fastify.post('/:id/resolve', { preHandler: authenticate }, async (request, reply) => {
    const { decision, decided_by } = request.body || {};
    if (!['approved', 'denied'].includes(decision)) {
      reply.code(400);
      return { error: 'decision must be approved or denied' };
    }

    const outcome = resolveApproval(
      request.params.id,
      decision,
      decided_by || request.user?.email || 'api'
    );

    if (!outcome.ok) {
      reply.code(404);
      return outcome;
    }

    // Set authorized=1 on the action when approved
    if (decision === 'approved' && outcome.action_id) {
      getDb().prepare('UPDATE agent_actions SET authorized=1 WHERE id=?').run(outcome.action_id);
    }

    return outcome;
  });
};
