'use strict';
/**
 * server.js — Fastify entry point
 * Phase 3: adds email OTP verification, company-email restriction, Google OAuth2
 */

require('dotenv').config();
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const { getDb } = require('./db');
const fastify = require('fastify')({ logger: true });

const PORT         = process.env.PORT         || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || '*';

// ── CORS ──────────────────────────────────────────────────────
fastify.addHook('onRequest', async (request, reply) => {
  reply.header('Access-Control-Allow-Origin',  FRONTEND_URL);
  reply.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  reply.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (request.method === 'OPTIONS') {
    return reply.code(204).send();
  }
});

// ── Existing routes (UNCHANGED) ───────────────────────────────
fastify.register(require('./api/health'),    { prefix: '/health' });
fastify.register(require('./api/approvals'), { prefix: '/approvals' });

// ── Payment webhooks (no auth) ────────────────────────────────
fastify.register(require('./api/webhooks/razorpay'), { prefix: '/webhooks/razorpay' });
fastify.register(require('./api/webhooks/paypal'),   { prefix: '/webhooks/paypal'   });

// ── Authenticated API routes ──────────────────────────────────
fastify.register(require('./api/me'),            { prefix: '/api/me'        });
fastify.register(require('./api/actions'),       { prefix: '/api/actions'   });
fastify.register(require('./api/audit'),         { prefix: '/api/audit'     });
fastify.register(require('./api/rules'),         { prefix: '/api/rules'     });
fastify.register(require('./api/settings'),      { prefix: '/api/settings'  });
fastify.register(require('./api/approvals_api'), { prefix: '/api/approvals' });

// ── Auth helpers ──────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'shield-dev-secret-change-in-prod';
const PUBLIC_DIR = path.join(__dirname, 'public');

// Email + OTP helpers
const { sendOtpEmail } = require('./utils/email');
const { generateOtp, checkRateLimit, validateOtp } = require('./utils/otp');

// Google OAuth helper
const googleAuth = require('./auth/google');

function makeToken(payload) {
  const full = {
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
  };
  const data = Buffer.from(JSON.stringify(full)).toString('base64url');
  const sig  = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function readToken(token) {
  try {
    const [data, sig] = (token || '').split('.');
    if (!data || !sig) return null;
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch { return null; }
}

function hashPw(pass, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  return { hash: crypto.pbkdf2Sync(pass, salt, 100_000, 32, 'sha256').toString('hex'), salt };
}

// ── Company email validation ──────────────────────────────────
const FORBIDDEN_DOMAINS = [
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com',
  'icloud.com', 'proton.me', 'protonmail.com', 'aol.com', 'gmx.com',
  'mail.com', 'yandex.com', 'qq.com', '163.com', '126.com',
  'foxmail.com', 'mail.ru', 'bk.ru', 'inbox.ru', 'list.ru',
];

const DISPOSABLE_PATTERNS = [
  'tempmail', '10minutemail', 'guerrillamail', 'throwaway',
  'mailinator', 'yopmail', 'sharklasers', 'getairmail',
];

function isCompanyEmail(email) {
  const domain = email.split('@')[1];
  if (!domain) return false;
  const d = domain.toLowerCase();
  if (FORBIDDEN_DOMAINS.includes(d)) return false;
  if (DISPOSABLE_PATTERNS.some(p => d.includes(p))) return false;
  return true;
}

// ── Database migration (idempotent) ───────────────────────────
function ensureAuthTables() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id              TEXT PRIMARY KEY,
      email           TEXT UNIQUE NOT NULL,
      hash            TEXT NOT NULL,
      salt            TEXT NOT NULL,
      workspace       TEXT NOT NULL,
      plan            TEXT NOT NULL DEFAULT 'free',
      created_at      INTEGER NOT NULL,
      email_verified  INTEGER DEFAULT 0,
      otp_code        TEXT,
      otp_expires_at  INTEGER
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      owner_id       TEXT NOT NULL,
      workspace_type TEXT NOT NULL DEFAULT 'company',
      created_at     INTEGER NOT NULL
    );
  `);

  // Idempotent column additions (SQLite doesn't support IF NOT EXISTS for ALTER)
  const userCols = db.prepare('PRAGMA table_info(users)').all();
  const wsCols   = db.prepare('PRAGMA table_info(workspaces)').all();

  if (!userCols.some(c => c.name === 'email_verified'))
    db.exec(`ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0`);
  if (!userCols.some(c => c.name === 'otp_code'))
    db.exec(`ALTER TABLE users ADD COLUMN otp_code TEXT`);
  if (!userCols.some(c => c.name === 'otp_expires_at'))
    db.exec(`ALTER TABLE users ADD COLUMN otp_expires_at INTEGER`);
  if (!wsCols.some(c => c.name === 'workspace_type'))
    db.exec(`ALTER TABLE workspaces ADD COLUMN workspace_type TEXT NOT NULL DEFAULT 'company'`);

  db.close();
}
ensureAuthTables();

async function requireAuth(request, reply) {
  const auth  = request.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return reply.code(401).send({ error: 'Unauthorized' });
  const payload = readToken(token);
  if (!payload) return reply.code(401).send({ error: 'Invalid or expired token' });
  request.user = payload;
}

// ── Static file serving ────────────────────────────────────────
function serveFile(filePath, contentType) {
  return async (request, reply) => {
    try {
      const content = fs.readFileSync(filePath);
      reply.header('Content-Type', contentType).send(content);
    } catch {
      reply.code(404).send('Not found');
    }
  };
}

const HTML = 'text/html; charset=utf-8';
fastify.get('/',                  serveFile(path.join(PUBLIC_DIR, 'index.html'),     HTML));
fastify.get('/index.html',        serveFile(path.join(PUBLIC_DIR, 'index.html'),     HTML));
fastify.get('/login.html',        serveFile(path.join(PUBLIC_DIR, 'login.html'),     HTML));
fastify.get('/login',             serveFile(path.join(PUBLIC_DIR, 'login.html'),     HTML));
fastify.get('/dashboard.html',    serveFile(path.join(PUBLIC_DIR, 'dashboard.html'), HTML));
fastify.get('/dashboard',         serveFile(path.join(PUBLIC_DIR, 'dashboard.html'), HTML));

// ── Auth routes ────────────────────────────────────────────────

// 1) SIGNUP (with OTP + company email check)
fastify.post('/api/auth/signup', async (request, reply) => {
  const { email, password, workspace, name } = request.body || {};
  if (!email || !password)    return reply.code(400).send({ error: 'email and password required' });
  if (password.length < 8)   return reply.code(400).send({ error: 'password must be at least 8 characters' });

  // Tag workspace type — personal emails allowed but tagged as 'solo'
  const wsType   = isCompanyEmail(email) ? 'company' : 'solo';
  const planName = wsType === 'company'  ? 'starter'  : 'solo_starter';

  const db = getDb();
  try {
    const existing = db.prepare('SELECT id, email_verified FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing && existing.email_verified === 1) {
      return reply.code(409).send({ error: 'Email already registered' });
    }

    const { hash, salt } = hashPw(password);
    const userId = crypto.randomUUID();
    const wsId   = crypto.randomUUID();
    const wsName = (workspace || '').trim() || (name ? name.trim() + "'s workspace" : email.split('@')[0] + "'s workspace");
    const now    = Date.now();

    // Generate OTP
    const otp        = generateOtp();
    const otpExpires = now + 10 * 60 * 1000; // 10 minutes

    if (existing) {
      // Re-signup: update password and OTP
      db.prepare('UPDATE users SET hash=?, salt=?, otp_code=?, otp_expires_at=?, email_verified=0 WHERE id=?')
        .run(hash, salt, otp, otpExpires, existing.id);
    } else {
      db.prepare('INSERT INTO workspaces (id, name, owner_id, workspace_type, created_at) VALUES (?,?,?,?,?)')
        .run(wsId, wsName, userId, wsType, now);
      db.prepare(`INSERT INTO users
        (id, email, hash, salt, workspace, plan, created_at, email_verified, otp_code, otp_expires_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(userId, email.toLowerCase(), hash, salt, wsId, planName, now, 0, otp, otpExpires);
    }

    // Send OTP email (fire-and-forget — don't block the response)
    sendOtpEmail(email.toLowerCase(), otp).catch(err => {
      fastify.log.warn({ err }, 'Failed to send OTP email');
    });

    return reply.code(201).send({
      status:         'pending_verification',
      email:          email.toLowerCase(),
      workspace_type: wsType,
    });
  } finally {
    db.close();
  }
});

// 2) REQUEST OTP (resend)
fastify.post('/api/auth/request-otp', async (request, reply) => {
  const { email } = request.body || {};
  if (!email) return reply.code(400).send({ error: 'email required' });

  const normalized = email.toLowerCase();

  // Rate limit check
  const limit = checkRateLimit(normalized);
  if (!limit.ok) {
    return reply.code(429).send({
      error: `Too many attempts. Please try again in ${limit.retryAfter}s.`,
    });
  }

  const db = getDb();
  try {
    const user = db.prepare('SELECT id, email_verified FROM users WHERE email = ?').get(normalized);

    // Always return generic success (don't leak whether email exists)
    if (!user || user.email_verified === 1) {
      return reply.send({ ok: true, message: 'If this email is registered, a new code has been sent.' });
    }

    const otp = generateOtp();
    const otpExpires = Date.now() + 10 * 60 * 1000;

    db.prepare('UPDATE users SET otp_code=?, otp_expires_at=? WHERE id=?')
      .run(otp, otpExpires, user.id);

    sendOtpEmail(normalized, otp).catch(err => {
      fastify.log.warn({ err }, 'Failed to resend OTP email');
    });

    return reply.send({ ok: true, message: 'If this email is registered, a new code has been sent.' });
  } finally {
    db.close();
  }
});

// 3) VERIFY OTP
fastify.post('/api/auth/verify-otp', async (request, reply) => {
  const { email, otp } = request.body || {};
  if (!email || !otp) return reply.code(400).send({ error: 'email and otp required' });

  const db = getDb();
  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
    if (!user) return reply.code(400).send({ error: 'Invalid OTP. Please try again.' });

    const check = validateOtp(otp, user.otp_code, user.otp_expires_at);
    if (!check.valid) {
      return reply.code(400).send({ error: check.reason });
    }

    // Mark verified, clear OTP
    db.prepare('UPDATE users SET email_verified=1, otp_code=NULL, otp_expires_at=NULL WHERE id=?')
      .run(user.id);

    const ws = db.prepare('SELECT name FROM workspaces WHERE id = ?').get(user.workspace);
    const token = makeToken({
      sub: user.id,
      email: user.email,
      workspace: user.workspace,
      plan: user.plan,
      name: ws ? ws.name : user.email,
    });

    return reply.send({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: ws ? ws.name : user.email,
        email_verified: true,
      },
      workspace_id: user.workspace,
    });
  } finally {
    db.close();
  }
});

// 4) LOGIN (enforce email verification)
fastify.post('/api/auth/login', async (request, reply) => {
  const { email, password } = request.body || {};
  if (!email || !password) return reply.code(400).send({ error: 'email and password required' });

  const db = getDb();
  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
    if (!user) return reply.code(401).send({ error: 'Invalid credentials' });

    const { hash } = hashPw(password, user.salt);
    if (hash !== user.hash) return reply.code(401).send({ error: 'Invalid credentials' });

    // Check email verification
    if (user.email_verified !== 1) {
      // Auto-send a new OTP if they're trying to log in unverified
      const otp = generateOtp();
      const otpExpires = Date.now() + 10 * 60 * 1000;
      db.prepare('UPDATE users SET otp_code=?, otp_expires_at=? WHERE id=?')
        .run(otp, otpExpires, user.id);

      sendOtpEmail(user.email, otp).catch(err => {
        fastify.log.warn({ err }, 'Failed to send OTP on login');
      });

      return reply.code(403).send({
        status: 'pending_verification',
        email: user.email,
      });
    }

    const ws    = db.prepare('SELECT name FROM workspaces WHERE id = ?').get(user.workspace);
    const token = makeToken({
      sub: user.id,
      email: user.email,
      workspace: user.workspace,
      plan: user.plan,
      name: ws ? ws.name : user.email,
    });

    return reply.send({
      token,
      user: {
        id: user.id,
        email: user.email,
        workspace: user.workspace,
        plan: user.plan,
        name: ws ? ws.name : user.email,
      },
    });
  } finally {
    db.close();
  }
});

// 5) GOOGLE OAUTH — Start
fastify.get('/api/auth/google/start', async (request, reply) => {
  try {
    const url = googleAuth.getAuthUrl();
    reply.redirect(url);
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({ error: 'Google OAuth not configured' });
  }
});

// 6) GOOGLE OAUTH — Callback
fastify.get('/api/auth/google/callback', async (request, reply) => {
  const { code, error: googleError } = request.query;

  if (googleError || !code) {
    return reply.redirect('/login.html?error=' + encodeURIComponent(googleError || 'Google sign-in was cancelled'));
  }

  try {
    const profile = await googleAuth.verifyCode(code);

    if (!profile.email_verified) {
      return reply.redirect('/login.html?error=' + encodeURIComponent('Your Google email is not verified'));
    }

    // Tag workspace type — personal Google accounts allowed but tagged as 'solo'
    const wsType = isCompanyEmail(profile.email) ? 'company' : 'solo';

    const db = getDb();
    try {
      let user = db.prepare('SELECT * FROM users WHERE email = ?').get(profile.email.toLowerCase());

      if (user) {
        // Existing user — ensure verified
        if (user.email_verified !== 1) {
          db.prepare('UPDATE users SET email_verified=1 WHERE id=?').run(user.id);
        }
      } else {
        // New user from Google — auto-create, mark verified immediately
        const userId   = crypto.randomUUID();
        const wsId     = crypto.randomUUID();
        const wsName   = (profile.name || profile.hd || profile.email.split('@')[0]) + "'s workspace";
        const planName = wsType === 'company' ? 'starter' : 'solo_starter';
        const now      = Date.now();

        db.prepare('INSERT INTO workspaces (id, name, owner_id, workspace_type, created_at) VALUES (?,?,?,?,?)')
          .run(wsId, wsName, userId, wsType, now);

        // No password for Google users — store a random hash they can't use
        const { hash, salt } = hashPw(crypto.randomBytes(32).toString('hex'));

        db.prepare(`INSERT INTO users
          (id, email, hash, salt, workspace, plan, created_at, email_verified)
          VALUES (?,?,?,?,?,?,?,?)`).run(
          userId,
          profile.email.toLowerCase(),
          hash,
          salt,
          wsId,
          planName,
          now,
          1
        );

        user = {
          id: userId,
          email: profile.email.toLowerCase(),
          workspace: wsId,
          plan: planName,
        };
      }

      const ws = db.prepare('SELECT name FROM workspaces WHERE id = ?').get(user.workspace);
      const token = makeToken({
        sub: user.id,
        email: user.email,
        workspace: user.workspace,
        plan: user.plan,
        name: ws ? ws.name : user.email,
      });

      // Redirect to dashboard with token in query param
      return reply.redirect(`/dashboard.html?token=${encodeURIComponent(token)}&workspace_id=${encodeURIComponent(user.workspace)}`);
    } finally {
      db.close();
    }
  } catch (err) {
    fastify.log.error(err);
    return reply.redirect('/login.html?error=' + encodeURIComponent('Google sign-in failed. Please try again.'));
  }
});

// ── Emergency override ─────────────────────────────────────────
fastify.post('/api/emergency-override', { preHandler: requireAuth }, async (request, reply) => {
  const { action_id, decision, reason } = request.body || {};
  if (!action_id || !['approve', 'deny'].includes(decision)) {
    return reply.code(400).send({ error: 'action_id and decision (approve|deny) required' });
  }
  const db = getDb();
  try {
    const status = decision === 'approve' ? 'approved' : 'denied';
    const result = db.prepare(
      `UPDATE agent_actions SET status = ?, reviewed_by = ?, reviewed_at = ?, review_reason = ? WHERE id = ?`
    ).run(status, request.user.sub, Date.now(), reason || null, action_id);
    if (result.changes === 0) return reply.code(404).send({ error: 'Action not found' });
    return reply.send({ ok: true, action_id, decision, status });
  } catch (err) {
    return reply.code(500).send({ error: err.message });
  } finally {
    db.close();
  }
});

// ── Start ─────────────────────────────────────────────────────
async function start() {
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    fastify.log.info(`Agent Shield running on port ${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
