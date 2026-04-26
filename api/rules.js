'use strict';
/**
 * api/rules.js
 *   GET   /api/rules            — list shield_rules for workspace
 *   POST  /api/rules            — insert new rule
 *   PATCH /api/rules/:id/toggle — flip active boolean
 *
 * DB uses lowercase verdicts: 'allow' | 'deny' | 'require_approval'
 * Frontend uses: 'ALLOW' | 'BLOCK' | 'PAUSE'
 * This file normalises both directions.
 */

const authenticate = require('../middleware/auth');
const { getDb }    = require('../db');

// Map frontend labels → DB values
const VERDICT_TO_DB = {
  ALLOW:  'allow',
  BLOCK:  'deny',
  PAUSE:  'require_approval',
  // pass-through if already lowercase
  allow:              'allow',
  deny:               'deny',
  require_approval:   'require_approval',
};

// Map DB values → frontend labels (for consistent API responses)
const VERDICT_TO_UI = {
  allow:            'ALLOW',
  deny:             'BLOCK',
  require_approval: 'PAUSE',
};

function normaliseRow(r) {
  return {
    ...r,
    active:  r.active === 1 || r.active === true,
    verdict: VERDICT_TO_UI[r.verdict] ?? r.verdict,
  };
}

module.exports = async function (fastify, opts) {
  // ── GET /api/rules ───────────────────────────────────────────
  fastify.get('/', { preHandler: authenticate }, async (request, reply) => {
    const { workspace_id } = request.user;
    const db   = getDb();
    const rows = db.prepare(
      `SELECT id, workspace_id, project_id, action_type, verdict,
              condition, reason, active, created_at
         FROM shield_rules
        WHERE workspace_id = ?
        ORDER BY created_at DESC`
    ).all(workspace_id);
    return { rows: rows.map(normaliseRow), total: rows.length };
  });

  // ── POST /api/rules ──────────────────────────────────────────
  fastify.post('/', { preHandler: authenticate }, async (request, reply) => {
    const { workspace_id } = request.user;
    const { rule_id, action_type, condition_json, verdict } = request.body || {};

    if (!rule_id || !action_type || !verdict) {
      reply.code(400);
      return { error: 'rule_id, action_type, and verdict are required' };
    }
    if (!/^[a-z0-9_]+$/.test(rule_id)) {
      reply.code(400);
      return { error: 'rule_id must be lowercase letters, numbers, and underscores only' };
    }

    const dbVerdict = VERDICT_TO_DB[verdict];
    if (!dbVerdict) {
      reply.code(400);
      return { error: `Invalid verdict "${verdict}" — use ALLOW, BLOCK, or PAUSE` };
    }

    const db = getDb();
    try {
      db.prepare(
        `INSERT INTO shield_rules (id, workspace_id, action_type, verdict, condition, active)
         VALUES (?, ?, ?, ?, ?, 1)`
      ).run(rule_id, workspace_id, action_type, dbVerdict, condition_json || null);
    } catch (e) {
      if (e.message.includes('UNIQUE')) {
        reply.code(409);
        return { error: `Rule "${rule_id}" already exists` };
      }
      throw e;
    }

    const row = db.prepare('SELECT * FROM shield_rules WHERE id = ?').get(rule_id);
    reply.code(201);
    return { ok: true, rule: normaliseRow(row) };
  });

  // ── PATCH /api/rules/:id/toggle ──────────────────────────────
  fastify.patch('/:id/toggle', { preHandler: authenticate }, async (request, reply) => {
    const { workspace_id } = request.user;
    const ruleId = request.params.id;
    const db = getDb();

    const existing = db.prepare(
      'SELECT * FROM shield_rules WHERE id = ? AND workspace_id = ?'
    ).get(ruleId, workspace_id);

    if (!existing) {
      reply.code(404);
      return { error: 'Rule not found' };
    }

    const newActive = existing.active === 1 ? 0 : 1;
    db.prepare('UPDATE shield_rules SET active = ? WHERE id = ?').run(newActive, ruleId);

    return { ok: true, id: ruleId, active: newActive === 1 };
  });
};
