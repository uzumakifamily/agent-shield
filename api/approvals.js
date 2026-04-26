'use strict';
/**
 * api/approvals.js — Minimal approval route stubs
 * FROZEN until unlock: no auth, no dashboard
 */

const { resolveApproval } = require('../brain/shield_kernel');
const { getDb } = require('../db');

module.exports = async function (fastify, opts) {
  // GET /approvals
  fastify.get('/', async (request, reply) => {
    return { message: 'FROZEN — approval list will be implemented after first external dev request' };
  });

  // POST /approvals/:id/resolve
  fastify.post('/:id/resolve', async (request, reply) => {
    const { decision } = request.body || {};
    if (!['approved', 'denied'].includes(decision)) {
      reply.code(400);
      return { error: 'decision must be approved or denied' };
    }

    const outcome = resolveApproval(request.params.id, decision, request.body?.decided_by || 'api');

    // Set authorized=1 on the action when approved so callers can poll for clearance
    if (outcome.ok && decision === 'approved' && outcome.action_id) {
      getDb().prepare('UPDATE agent_actions SET authorized=1 WHERE id=?').run(outcome.action_id);
    }

    return outcome;
  });
};
