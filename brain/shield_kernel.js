'use strict';
/**
 * brain/shield_kernel.js — Agent Shield canonical kernel
 * 3-hook architecture. Source of truth.
 *
 * Hook 1 — getPermittedTools(workspaceId, projectId, availableTools)
 * Hook 2 — async before(ctx)
 * Hook 3 — async after(actionId, rawResult, workspaceId, projectId)
 *
 * Main entry: await shield.run(ctx, executeFn)
 */

const { getDb } = require('../db');
const { riskScore, redactPII, estimateCost } = require('../utils/helpers');
const { notifyApproval } = require('../utils/notify');
const crypto = require('crypto');

let _db = null;
function db() {
  if (!_db) _db = getDb();
  return _db;
}

function uuid() {
  return crypto.randomUUID();
}

// ─────────────────────────────────────────────────────────────
// Hook 1 — getPermittedTools
// ─────────────────────────────────────────────────────────────
function getPermittedTools(workspaceId, projectId, availableTools) {
  const denied = db().prepare(`
    SELECT action_type FROM shield_rules
    WHERE workspace_id = ? AND (project_id = ? OR project_id IS NULL)
      AND verdict = 'deny' AND active = 1
  `).all(workspaceId, projectId).map(r => r.action_type);

  return availableTools.filter(t => !denied.includes(t));
}

// ─────────────────────────────────────────────────────────────
// Hook 2 — before(ctx)
// ─────────────────────────────────────────────────────────────
async function before(ctx) {
  const {
    workspaceId, projectId, agent, actionType, source, payload,
  } = ctx;

  // 1. Log intent immediately (append-only)
  const actionId = uuid();
  db().prepare(`
    INSERT INTO agent_actions
      (id, workspace_id, project_id, agent, action_type, source, payload, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(actionId, workspaceId, projectId, agent, actionType, source, JSON.stringify(payload || {}));

  // 2. Prompt injection defense
  const untrustedSources = ['web_content', 'email'];
  const highRiskActions = ['send_email', 'shell_execute', 'run_code', 'deploy', 'delete_file'];
  if (untrustedSources.includes(source) && highRiskActions.includes(actionType)) {
    db().prepare(`UPDATE agent_actions SET status='denied', hook_verdict='BLOCK', note='Prompt injection defense' WHERE id=?`).run(actionId);
    return { proceed: false, verdict: 'BLOCK', action_id: actionId, reason: 'Untrusted source + high-risk action blocked' };
  }

  // 3. Budget check
  const budget = db().prepare(`
    SELECT * FROM usage_budgets WHERE workspace_id=? AND project_id=? LIMIT 1
  `).get(workspaceId, projectId);

  if (budget) {
    const now = new Date().toISOString();
    // Reset daily if needed
    const lastDaily = budget.last_reset_daily ? new Date(budget.last_reset_daily) : null;
    if (!lastDaily || new Date(now).toDateString() !== lastDaily.toDateString()) {
      db().prepare(`UPDATE usage_budgets SET current_daily_usd=0, last_reset_daily=? WHERE id=?`).run(now, budget.id);
      budget.current_daily_usd = 0;
    }
    // Reset monthly if needed
    const lastMonthly = budget.last_reset_monthly ? new Date(budget.last_reset_monthly) : null;
    if (!lastMonthly || new Date(now).getMonth() !== lastMonthly.getMonth()) {
      db().prepare(`UPDATE usage_budgets SET current_monthly_usd=0, last_reset_monthly=? WHERE id=?`).run(now, budget.id);
      budget.current_monthly_usd = 0;
    }

    if (budget.daily_limit_usd > 0 && budget.current_daily_usd >= budget.daily_limit_usd) {
      db().prepare(`UPDATE agent_actions SET status='paused', hook_verdict='PAUSE', note='Daily budget exceeded' WHERE id=?`).run(actionId);
      db().prepare(`UPDATE usage_budgets SET status='PAUSED' WHERE id=?`).run(budget.id);
      return { proceed: false, verdict: 'PAUSE', action_id: actionId, reason: 'Daily budget limit exceeded' };
    }
    if (budget.monthly_limit_usd > 0 && budget.current_monthly_usd >= budget.monthly_limit_usd) {
      db().prepare(`UPDATE agent_actions SET status='paused', hook_verdict='PAUSE', note='Monthly budget exceeded' WHERE id=?`).run(actionId);
      db().prepare(`UPDATE usage_budgets SET status='PAUSED' WHERE id=?`).run(budget.id);
      return { proceed: false, verdict: 'PAUSE', action_id: actionId, reason: 'Monthly budget limit exceeded' };
    }
  }

  // 4. Permission rule lookup
  const rules = db().prepare(`
    SELECT * FROM shield_rules
    WHERE workspace_id = ? AND (project_id = ? OR project_id IS NULL)
      AND action_type = ? AND active = 1
    ORDER BY project_id DESC  -- project-specific rules win over workspace-wide
  `).all(workspaceId, projectId, actionType);

  let ruleVerdict = null;
  let ruleReason = null;
  for (const rule of rules) {
    ruleVerdict = rule.verdict;
    ruleReason = rule.reason;
    if (ruleVerdict !== 'allow') break; // most restrictive wins
  }

  // 5. Risk scoring
  const score = riskScore({ actionType, source, payload });

  // 6. Verdict
  // Rules take precedence over heuristic scoring
  let verdict = 'ALLOW';
  if (ruleVerdict === 'deny') verdict = 'BLOCK';
  else if (ruleVerdict === 'require_approval') verdict = 'PAUSE';
  else if (!ruleVerdict && score > 0.6) verdict = 'PAUSE'; // heuristic only when no explicit rule

  if (verdict === 'BLOCK') {
    db().prepare(`UPDATE agent_actions SET status='denied', hook_verdict='BLOCK', risk_score=?, note=? WHERE id=?`).run(score, ruleReason || 'Rule denied', actionId);
    return { proceed: false, verdict: 'BLOCK', action_id: actionId, reason: ruleReason || 'Blocked by rule' };
  }

  if (verdict === 'PAUSE') {
    const approvalId = uuid();
    db().prepare(`UPDATE agent_actions SET status='paused', hook_verdict='PAUSE', risk_score=? WHERE id=?`).run(score, actionId);
    db().prepare(`
      INSERT INTO approval_queue (id, workspace_id, project_id, action_id, reason, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(approvalId, workspaceId, projectId, actionId, ruleReason || `Risk score ${score.toFixed(2)}`);

    // Notify — pass workspaceId so notify.js reads per-workspace Telegram config
    const tgMsgId = await notifyApproval({ approvalId, actionId, agent, actionType, reason: ruleReason || `Risk score ${score.toFixed(2)}`, workspaceId });
    if (tgMsgId) {
      db().prepare(`UPDATE approval_queue SET tg_msg_id=?, notified_at=datetime('now') WHERE id=?`).run(tgMsgId, approvalId);
    }

    return { proceed: false, verdict: 'PAUSE', action_id: actionId, reason: ruleReason || `Risk score ${score.toFixed(2)}`, approval_id: approvalId };
  }

  // ALLOW
  db().prepare(`UPDATE agent_actions SET status='allowed', hook_verdict='ALLOW', risk_score=? WHERE id=?`).run(score, actionId);
  return { proceed: true, verdict: 'ALLOW', action_id: actionId, reason: 'Allowed' };
}

// ─────────────────────────────────────────────────────────────
// Hook 3 — after(actionId, rawResult, workspaceId, projectId)
// ─────────────────────────────────────────────────────────────
async function after(actionId, rawResult, workspaceId, projectId) {
  // 1. Scan for PII, API keys, credentials
  const isObject = rawResult !== null && typeof rawResult === 'object';
  const rawStr = isObject ? JSON.stringify(rawResult) : String(rawResult || '');
  const scan = redactPII(rawStr);

  // 2. Redact — preserve object structure when input was an object
  let cleanResult;
  if (isObject) {
    try { cleanResult = JSON.parse(scan.redacted); } catch { cleanResult = rawResult; }
  } else {
    cleanResult = scan.redacted;
  }

  // 3. Log what was redacted
  const redactions = scan.matches.length > 0 ? `Redacted: ${scan.matches.join(', ')}` : null;

  // 4. Update action cost
  const tokens = estimateCost(rawResult);
  const costUsd = tokens * 0.00001; // naive: $0.01 per 1K tokens

  db().prepare(`
    UPDATE agent_actions
    SET result=?, cost_tokens=?, cost_usd=?, note=COALESCE(note,?) || ' | ' || ?,
        status='done', resolved_at=datetime('now')
    WHERE id=?
  `).run(
    JSON.stringify(cleanResult), tokens, costUsd, '', redactions || 'No redaction', actionId
  );

  // 5. Update usage_budgets
  db().prepare(`
    UPDATE usage_budgets
    SET current_daily_usd = current_daily_usd + ?,
        current_monthly_usd = current_monthly_usd + ?,
        updated_at = datetime('now')
    WHERE workspace_id=? AND project_id=?
  `).run(costUsd, costUsd, workspaceId, projectId);

  return cleanResult;
}

// ─────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────
async function run(ctx, executeFn) {
  const beforeResult = await before(ctx);
  if (!beforeResult.proceed) return beforeResult;

  let rawResult;
  try {
    rawResult = await executeFn();
  } catch (err) {
    db().prepare(`UPDATE agent_actions SET status='failed', note=? WHERE id=?`).run(err.message, beforeResult.action_id);
    throw err;
  }

  const cleanResult = await after(beforeResult.action_id, rawResult, ctx.workspaceId, ctx.projectId);
  return cleanResult;
}

// ─────────────────────────────────────────────────────────────
// Resolve approval (called by Telegram bot, API, or dashboard)
// ─────────────────────────────────────────────────────────────
function resolveApproval(approvalId, decision, decidedBy = 'system') {
  const row = db().prepare(`SELECT * FROM approval_queue WHERE id=?`).get(approvalId);
  if (!row) return { ok: false, error: 'Approval not found' };

  db().prepare(`
    UPDATE approval_queue
    SET decision=?, decided_by=?, decided_at=datetime('now')
    WHERE id=?
  `).run(decision, decidedBy, approvalId);

  const actionStatus = decision === 'approved' ? 'allowed' : 'denied';
  db().prepare(`UPDATE agent_actions SET status=?, resolved_at=datetime('now') WHERE id=?`).run(actionStatus, row.action_id);

  return { ok: true, action_id: row.action_id, decision };
}

// ─────────────────────────────────────────────────────────────
// registerClaim — enforce ai_claims rule
// ─────────────────────────────────────────────────────────────
function registerClaim(workspaceId, projectId, actionId, claimText, claimType, opts = {}) {
  const id = uuid();
  db().prepare(`
    INSERT INTO ai_claims
      (id, workspace_id, project_id, action_id, claim_text, claim_type,
       source_record_id, source_table, confidence, shown_to_user)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, workspaceId, projectId, actionId, claimText, claimType,
    opts.sourceRecordId || null, opts.sourceTable || null,
    opts.confidence || 0, opts.shownToUser ? 1 : 0
  );
  return id;
}

module.exports = {
  getPermittedTools,
  before,
  after,
  run,
  resolveApproval,
  registerClaim,
};
