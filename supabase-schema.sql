-- =====================================================
-- Agent Shield — Supabase/Postgres schema
-- Idempotent: safe to run multiple times
-- Does NOT touch the existing SQLite schema (db/schema.sql)
-- =====================================================

-- 1. Plans (reference table, seeded below)
CREATE TABLE IF NOT EXISTS plans (
  id            TEXT         PRIMARY KEY,   -- 'free' | 'pro' | 'enterprise'
  name          TEXT         NOT NULL,
  price_inr     INT          NOT NULL,      -- paise (₹999 = 99900)
  price_usd     NUMERIC(6,2) NOT NULL,
  action_limit  INT          NOT NULL,      -- -1 = unlimited
  audit_days    INT          NOT NULL
);

INSERT INTO plans (id, name, price_inr, price_usd, action_limit, audit_days) VALUES
  ('free',       'Starter',    0,      0.00,   500,   7),
  ('pro',        'Pro',        99900,  12.00,  10000, 90),
  ('enterprise', 'Enterprise', 499900, 60.00,  -1,    365)
ON CONFLICT (id) DO NOTHING;

-- 2. Workspaces
CREATE TABLE IF NOT EXISTS workspaces (
  id          TEXT        PRIMARY KEY,   -- e.g. 'ws_allkinz' — must match SQLite workspace_id
  name        TEXT        NOT NULL,
  owner_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Subscriptions (one per workspace)
CREATE TABLE IF NOT EXISTS subscriptions (
  id                   UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         TEXT  NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_id              TEXT  NOT NULL REFERENCES plans(id) DEFAULT 'free',
  status               TEXT  NOT NULL DEFAULT 'active',  -- active | cancelled | past_due
  razorpay_payment_id  TEXT,
  paypal_order_id      TEXT,
  period_end           TIMESTAMPTZ,                      -- NULL = free forever
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id)                                   -- one subscription per workspace
);

-- 4. Invoices
CREATE TABLE IF NOT EXISTS invoices (
  id            UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  TEXT  NOT NULL REFERENCES workspaces(id),
  plan_id       TEXT  NOT NULL,
  amount_inr    INT,                    -- paise, NULL if PayPal
  amount_usd    NUMERIC(6,2),          -- NULL if Razorpay
  currency      TEXT  NOT NULL,        -- 'INR' | 'USD'
  provider      TEXT  NOT NULL,        -- 'razorpay' | 'paypal'
  payment_id    TEXT  NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 5. User settings (one row per workspace)
CREATE TABLE IF NOT EXISTS user_settings (
  workspace_id        TEXT    PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  dry_run             BOOLEAN NOT NULL DEFAULT TRUE,
  telegram_bot_token  TEXT,
  telegram_chat_id    TEXT,
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Row-Level Security ────────────────────────────────────────
ALTER TABLE workspaces    ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices      ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- Drop before recreate so re-runs never error
DROP POLICY IF EXISTS "owner_only" ON workspaces;
DROP POLICY IF EXISTS "owner_only" ON subscriptions;
DROP POLICY IF EXISTS "owner_only" ON invoices;
DROP POLICY IF EXISTS "owner_only" ON user_settings;

-- Owner sees only their own rows
CREATE POLICY "owner_only" ON workspaces
  FOR ALL USING (owner_id = auth.uid());

CREATE POLICY "owner_only" ON subscriptions
  FOR ALL USING (
    workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())
  );

CREATE POLICY "owner_only" ON invoices
  FOR ALL USING (
    workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())
  );

CREATE POLICY "owner_only" ON user_settings
  FOR ALL USING (
    workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())
  );
