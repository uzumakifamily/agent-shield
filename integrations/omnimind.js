'use strict';
/**
 * integrations/omnimind.js — OMNIMIND-specific wrapper helpers
 *
 * Usage in api_server.js:
 *   const { shieldSendEmailWithFn } = require('../../agent-shield-core/integrations/omnimind');
 *   const result = await shieldSendEmailWithFn(lead, subject, body, 'outreach', sendFn);
 *
 * Return shapes (always check result.paused before result.ok):
 *   ALLOW  → { ok: true, ... }   (result from sendFn, or dry-run stub)
 *   PAUSE  → { ok: false, paused: true, approval_id, action_id }
 *   BLOCK  → { ok: false, blocked: true, error: string }
 */

const shield = require('./sdk');

const WORKSPACE_ID = 'ws_allkinz';
const PROJECT_ID   = 'proj_cold_email';
const AGENT_NAME   = 'cold_email_bot';

/**
 * Wrap an email send with Agent Shield governance.
 * DRY_RUN is read at call-time so tests can flip the env var mid-run.
 */
async function shieldSendEmailWithFn(lead, subject, body, type, sendFn) {
  const isDryRun = process.env.SHIELD_DRY_RUN === 'true';
  const to       = lead?.contact_email;
  const leadId   = lead?.id;

  const ctx = {
    workspaceId: WORKSPACE_ID,
    projectId:   PROJECT_ID,
    agent:       AGENT_NAME,
    actionType:  'send_email',
    source:      'api',
    payload:     { to, subject, leadId, type },
  };

  const result = await shield.run(ctx, async () => {
    if (isDryRun) {
      console.log(`[SHIELD DRY-RUN] Skipping send to ${to} — subject: ${subject}`);
      return { ok: true, dryRun: true, message: 'Email blocked by dry-run mode', to, subject };
    }
    return await sendFn(to, subject, body, leadId);
  });

  // ── Normalize kernel PAUSE / BLOCK into a consistent caller interface ──
  // shield.run() returns { proceed: false, verdict, action_id, approval_id? }
  // when before() doesn't allow the action.
  if (result && result.proceed === false) {
    if (result.verdict === 'PAUSE') {
      return {
        ok:          false,
        paused:      true,
        approval_id: result.approval_id,
        action_id:   result.action_id,
      };
    }
    // BLOCK
    return {
      ok:      false,
      blocked: true,
      error:   result.reason || 'Blocked by Agent Shield',
    };
  }

  // ALLOW path — result is the after()-processed output of executeFn
  return result || { ok: false, error: 'No result from shield' };
}

/**
 * Convenience alias (no sendFn required — throws if actually called live).
 * Kept for backwards compatibility. Prefer shieldSendEmailWithFn.
 */
async function shieldSendEmail(lead, subject, body, type = 'outreach') {
  return shieldSendEmailWithFn(lead, subject, body, type, async () => {
    throw new Error('shieldSendEmail: pass a sendFn or use shieldSendEmailWithFn');
  });
}

module.exports = {
  shieldSendEmail,
  shieldSendEmailWithFn,
  WORKSPACE_ID,
  PROJECT_ID,
  AGENT_NAME,
  // Dynamic getter so tests can toggle SHIELD_DRY_RUN mid-run
  get DRY_RUN() { return process.env.SHIELD_DRY_RUN === 'true'; },
};
