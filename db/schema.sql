-- agent-shield-core database schema
-- 5 tables, append-only design

-- 1. Every action any agent takes, logged before execution
CREATE TABLE IF NOT EXISTS agent_actions (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  project_id    TEXT NOT NULL,
  agent         TEXT NOT NULL,
  action_type   TEXT NOT NULL,
  source        TEXT NOT NULL,  -- 'user_input' | 'web_content' | 'email' | 'cron' | 'api'
  payload       TEXT,            -- JSON
  result        TEXT,            -- JSON (redacted)
  status        TEXT DEFAULT 'pending',  -- pending | allowed | paused | denied | done | failed
  risk_score    REAL DEFAULT 0,
  hook_verdict  TEXT,            -- ALLOW | PAUSE | BLOCK
  cost_tokens   INTEGER DEFAULT 0,
  cost_usd      REAL DEFAULT 0,
  authorized    INTEGER DEFAULT 0,
  note          TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  resolved_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_actions_workspace ON agent_actions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_actions_project    ON agent_actions(workspace_id, project_id);
CREATE INDEX IF NOT EXISTS idx_actions_status     ON agent_actions(status);

-- 2. Allow/deny rulebook per project
CREATE TABLE IF NOT EXISTS shield_rules (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  project_id    TEXT,              -- NULL = workspace-wide
  action_type   TEXT NOT NULL,
  verdict       TEXT NOT NULL,     -- allow | deny | require_approval
  source_trust  TEXT,              -- JSON array of trusted sources
  condition     TEXT,              -- JSON
  reason        TEXT,
  active        INTEGER DEFAULT 1,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rules_workspace ON shield_rules(workspace_id);
CREATE INDEX IF NOT EXISTS idx_rules_project   ON shield_rules(workspace_id, project_id);

-- 3. Actions paused waiting for human approval
CREATE TABLE IF NOT EXISTS approval_queue (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  project_id    TEXT NOT NULL,
  action_id     TEXT NOT NULL REFERENCES agent_actions(id),
  reason        TEXT,
  tg_msg_id     TEXT,
  notified_at   TEXT,
  decided_at    TEXT,
  decision      TEXT,              -- approved | denied
  decided_by    TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_approvals_action ON approval_queue(action_id);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approval_queue(decision);

-- 4. Every claim/output shown to a user, with verification label
CREATE TABLE IF NOT EXISTS ai_claims (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL,
  project_id        TEXT NOT NULL,
  action_id         TEXT REFERENCES agent_actions(id),
  claim_text        TEXT NOT NULL,
  claim_type        TEXT NOT NULL,  -- VERIFIED | INFERRED | NEEDS_MORE_DATA
  source_record_id  TEXT,
  source_table      TEXT,
  confidence        REAL DEFAULT 0,
  shown_to_user     INTEGER DEFAULT 0,
  created_at        TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_claims_action ON ai_claims(action_id);

-- 5. Per-project budget tracking
CREATE TABLE IF NOT EXISTS usage_budgets (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL,
  project_id        TEXT NOT NULL UNIQUE,
  daily_limit_usd   REAL DEFAULT 0,
  monthly_limit_usd REAL DEFAULT 0,
  current_daily_usd REAL DEFAULT 0,
  current_monthly_usd REAL DEFAULT 0,
  status            TEXT DEFAULT 'ACTIVE',  -- ACTIVE | WARNING | PAUSED
  last_reset_daily  TEXT,
  last_reset_monthly TEXT,
  updated_at        TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_budgets_project ON usage_budgets(workspace_id, project_id);

-- Seed default safe rules for workspace 'ws_allkinz'
INSERT OR IGNORE INTO shield_rules (id, workspace_id, project_id, action_type, verdict, reason)
VALUES
  ('rule_email_default',  'ws_allkinz', NULL, 'send_email',     'require_approval', 'Default: emails require approval'),
  ('rule_delete_default', 'ws_allkinz', NULL, 'delete_file',    'deny',             'Default: file deletion blocked'),
  ('rule_shell_default',  'ws_allkinz', NULL, 'shell_execute',  'deny',             'Default: shell execution blocked'),
  ('rule_run_code_default','ws_allkinz', NULL, 'run_code',      'deny',             'Default: code execution blocked'),
  ('rule_deploy_default', 'ws_allkinz', NULL, 'deploy',         'deny',             'Default: deploy blocked'),
  ('rule_read_default',   'ws_allkinz', NULL, 'read_file',      'allow',            'Default: read allowed'),
  ('rule_fetch_default',  'ws_allkinz', NULL, 'fetch_url',      'allow',            'Default: fetch allowed'),
  ('rule_write_default',  'ws_allkinz', NULL, 'write_output',   'allow',            'Default: write output allowed'),
  ('rule_search_default', 'ws_allkinz', NULL, 'search',         'allow',            'Default: search allowed');

-- Seed budget for cold email project
INSERT OR IGNORE INTO usage_budgets (id, workspace_id, project_id, daily_limit_usd, monthly_limit_usd, status)
VALUES ('budget_coldemail', 'ws_allkinz', 'proj_cold_email', 5, 50, 'ACTIVE');
