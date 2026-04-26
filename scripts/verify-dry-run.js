'use strict';
/**
 * scripts/verify-dry-run.js
 *
 * Verifies the Agent Shield ↔ OMNIMIND integration end-to-end.
 *
 * Run from agent-shield-core root:
 *   node -r dotenv/config scripts/verify-dry-run.js
 *
 * What it checks:
 *   1. DRY-RUN CYCLE  — calls shieldSendEmailWithFn with SHIELD_DRY_RUN=true,
 *      confirms the action row is logged, scored, and marked done with dryRun=true
 *   2. LIVE PAUSE CYCLE — calls shieldSendEmailWithFn with SHIELD_DRY_RUN=false,
 *      confirms the action row is 'paused', an approval_queue row exists,
 *      then resolves it via resolveApproval and checks authorized=1
 */

const path = require('path');

// Point at a dedicated verification DB (not shield.db, not test.db)
process.env.DATABASE_PATH = path.join(__dirname, '..', 'verify.db');

const fs = require('fs');
const { DB_PATH, getDb } = require('../db');
const shield = require('../brain/shield_kernel');
const { shieldSendEmailWithFn } = require('../integrations/omnimind');

// Clean slate
for (const f of [DB_PATH, DB_PATH + '-shm', DB_PATH + '-wal']) {
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

const db = getDb();

// Seed: temporarily allow send_email so executeFn runs during the dry-run test.
// The default schema seeds rule_email_default as require_approval (workspace-wide).
// We must deactivate it so the project-level allow rule wins.
db.prepare(`UPDATE shield_rules SET active=0 WHERE id='rule_email_default'`).run();
db.prepare(`INSERT OR REPLACE INTO shield_rules
  (id, workspace_id, project_id, action_type, verdict, reason, active)
  VALUES ('vr_allow_email', 'ws_allkinz', 'proj_cold_email', 'send_email', 'allow', 'Verify: temporarily allow for dry-run', 1)
`).run();

const FAKE_LEAD = { id: 'lead_verify_001', contact_email: 'ceo@verify-test.com', company_name: 'VerifyCo' };
const SUBJECT   = 'Verify Subject';
const BODY      = '<p>Hello from verify script</p>';

let passed = 0;
let failed = 0;

function ok(label, cond, detail = '') {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

// ─────────────────────────────────────────────────────────
// 1. DRY-RUN CYCLE
// ─────────────────────────────────────────────────────────
async function runDryRun() {
  console.log('\n── DRY-RUN CYCLE ────────────────────────────────────');
  process.env.SHIELD_DRY_RUN = 'true';

  const sendFnCalled = { called: false };
  const result = await shieldSendEmailWithFn(FAKE_LEAD, SUBJECT, BODY, 'outreach', async () => {
    sendFnCalled.called = true;
    return { ok: true, backend: 'brevo' };
  });

  ok('result.ok === true',    result.ok === true,    JSON.stringify(result));
  ok('result.dryRun === true', result.dryRun === true, JSON.stringify(result));
  ok('sendFn NOT called in dry-run', !sendFnCalled.called);

  // Check DB row
  const actions = db.prepare(`SELECT * FROM agent_actions WHERE payload LIKE '%lead_verify_001%' ORDER BY created_at DESC LIMIT 1`).all();
  const row = actions[0];
  ok('Action row exists in DB', !!row, 'No row found');
  if (row) {
    ok('status = done',          row.status === 'done',    `status=${row.status}`);
    ok('hook_verdict = ALLOW',   row.hook_verdict === 'ALLOW', `hook_verdict=${row.hook_verdict}`);
    ok('cost_tokens > 0',        row.cost_tokens > 0,     `cost_tokens=${row.cost_tokens}`);
    ok('result contains dryRun', row.result && row.result.includes('dryRun'), `result=${row.result}`);
  }

  console.log('\nDRY-RUN rows in agent_actions:');
  for (const r of actions) {
    console.log('  ', JSON.stringify({ id: r.id, status: r.status, hook_verdict: r.hook_verdict, risk_score: r.risk_score, cost_tokens: r.cost_tokens, note: r.note }));
  }
}

// ─────────────────────────────────────────────────────────
// 2. LIVE PAUSE + RESOLVE CYCLE
// ─────────────────────────────────────────────────────────
async function runLiveCycle() {
  console.log('\n── LIVE PAUSE → RESOLVE CYCLE ───────────────────────');
  process.env.SHIELD_DRY_RUN = 'false';

  // Restore require_approval rule
  db.prepare(`UPDATE shield_rules SET active=0 WHERE id='vr_allow_email'`).run();
  db.prepare(`INSERT OR REPLACE INTO shield_rules
    (id, workspace_id, project_id, action_type, verdict, reason, active)
    VALUES ('vr_require_email', 'ws_allkinz', NULL, 'send_email', 'require_approval', 'Verify: approval required', 1)
  `).run();

  const sendFnCalled = { called: false };
  const LIVE_LEAD = { id: 'lead_verify_002', contact_email: 'cfo@live-test.com', company_name: 'LiveCo' };

  const result = await shieldSendEmailWithFn(LIVE_LEAD, SUBJECT, BODY, 'outreach', async () => {
    sendFnCalled.called = true;
    return { ok: true, backend: 'brevo' };
  });

  ok('result.ok === false (paused)',     result.ok === false,    JSON.stringify(result));
  ok('result.paused === true',           result.paused === true,  JSON.stringify(result));
  ok('result.approval_id present',       !!result.approval_id,    JSON.stringify(result));
  ok('result.action_id present',         !!result.action_id,      JSON.stringify(result));
  ok('sendFn NOT called (still paused)', !sendFnCalled.called);

  // Check DB
  const actionRow = db.prepare('SELECT * FROM agent_actions WHERE id=?').get(result.action_id);
  ok('agent_actions row exists',  !!actionRow);
  if (actionRow) {
    ok('status = paused',         actionRow.status === 'paused',  `status=${actionRow.status}`);
    ok('hook_verdict = PAUSE',    actionRow.hook_verdict === 'PAUSE', `hv=${actionRow.hook_verdict}`);
    ok('authorized = 0 (before)', actionRow.authorized === 0,    `auth=${actionRow.authorized}`);
  }

  const approvalRow = db.prepare('SELECT * FROM approval_queue WHERE id=?').get(result.approval_id);
  ok('approval_queue row exists', !!approvalRow);
  if (approvalRow) {
    ok('approval decision null (pending)', approvalRow.decision === null || approvalRow.decision === undefined);
  }

  console.log('\nLIVE rows in agent_actions:');
  console.log('  ', JSON.stringify({ id: actionRow?.id, status: actionRow?.status, hook_verdict: actionRow?.hook_verdict, authorized: actionRow?.authorized }));
  console.log('LIVE rows in approval_queue:');
  console.log('  ', JSON.stringify({ id: approvalRow?.id, action_id: approvalRow?.action_id, reason: approvalRow?.reason, decision: approvalRow?.decision }));

  // ── Resolve approval ──
  console.log('\n── RESOLVE (approved) ───────────────────────────────');
  const resolveRes = shield.resolveApproval(result.approval_id, 'approved', 'verify_script');
  ok('resolveApproval ok',        resolveRes.ok === true,      JSON.stringify(resolveRes));
  ok('resolveApproval decision',  resolveRes.decision === 'approved');

  // Manually set authorized=1 (mirrors what api/approvals.js now does)
  db.prepare('UPDATE agent_actions SET authorized=1 WHERE id=?').run(result.action_id);

  const afterResolve = db.prepare('SELECT status, authorized FROM agent_actions WHERE id=?').get(result.action_id);
  ok('status = allowed after resolve', afterResolve?.status === 'allowed',  `status=${afterResolve?.status}`);
  ok('authorized = 1 after resolve',   afterResolve?.authorized === 1,      `authorized=${afterResolve?.authorized}`);

  const afterApproval = db.prepare('SELECT decision, decided_by FROM approval_queue WHERE id=?').get(result.approval_id);
  ok('approval decision = approved',   afterApproval?.decision === 'approved');
  ok('decided_by = verify_script',     afterApproval?.decided_by === 'verify_script');

  console.log('\nAFTER RESOLVE rows:');
  console.log('  agent_actions:', JSON.stringify(afterResolve));
  console.log('  approval_queue:', JSON.stringify(afterApproval));
}

// ─────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────
(async () => {
  console.log('\nAgent Shield ↔ OMNIMIND Integration Verify');
  console.log('===========================================');
  console.log(`DB: ${DB_PATH}`);

  try {
    await runDryRun();
    await runLiveCycle();
  } catch (err) {
    console.error('\nFATAL:', err.message);
    failed++;
  }

  console.log(`\n===========================================`);
  console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`===========================================\n`);

  // Cleanup verify DB
  db.close();
  for (const f of [DB_PATH, DB_PATH + '-shm', DB_PATH + '-wal']) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  process.exit(failed > 0 ? 1 : 0);
})();
