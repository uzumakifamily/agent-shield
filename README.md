# AgentShield

**Runtime control layer for AI agents.** Allow, pause, or block any agent action before it causes damage — policy engine, approval flows, risk scoring, and audit trail in one self-hostable package.

🌐 **Live:** [agentshield.allkinz.com](https://agentshield.allkinz.com)  
📦 **License:** MIT  
🔧 **Stack:** Node.js 18+ · Fastify 4 · better-sqlite3 · JWT

---

## What It Does

AgentShield sits between your AI agent and the outside world. Every action your agent wants to take passes through the Shield kernel:

1. **Risk scoring** — each action gets a 0–1 risk score based on action type and payload
2. **Policy engine** — your rules decide: ALLOW, PAUSE (wait for human approval), or BLOCK
3. **Approval flows** — high-risk actions pause and notify you via Telegram before proceeding
4. **Audit trail** — every decision is logged with verdict, score, timestamp, and reviewer

---

## Quick Start (Self-Hosted)

```bash
git clone https://github.com/allkinz/agent-shield
cd agent-shield
npm install
cp .env.example .env        # fill in JWT_SECRET at minimum
npm run dev                 # starts on http://localhost:3000
```

Open `http://localhost:3000` → sign up → grab your API key from Settings.

---

## Integration (3 Lines)

```js
const shield = require('agent-shield-sdk'); // or use the REST API

await shield.run({
  workspaceId: 'your_workspace_id',
  actionType:  'send_email',
  payload:     { to: 'customer@example.com', subject: 'Follow-up' },
}, async () => {
  // only runs if Shield says ALLOW
  await sendEmail(...);
});
```

**REST API:**
```bash
curl -X POST https://your-shield-instance/api/actions \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{ "action_type": "send_email", "payload": { "to": "customer@example.com" } }'
```

---

## Architecture

```
server.js              — Fastify entry point, CORS, security headers, auth routes
brain/shield_kernel.js — Core hook engine (before / after / onError)
brain/risk_scorer.js   — Risk scoring per action type
brain/policy_engine.js — Rule evaluation (ALLOW / PAUSE / BLOCK)
api/actions.js         — POST /api/actions — SDK REST entry point
api/rules.js           — CRUD for workspace rules
api/audit.js           — Paginated audit log export
api/approvals.js       — Approval webhook receiver
api/health.js          — GET /health
db/                    — better-sqlite3 schema + migrations
utils/                 — JWT, OTP, email, risk helpers
public/                — Static HTML (index, login, dashboard, privacy, terms)
```

---

## Environment Variables

See `.env.example` for all variables with descriptions. Minimum required:

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | ✅ | Secret for signing JWTs — min 32 chars |
| `DATABASE_PATH` | optional | SQLite file path (default: `./shield.db`) |
| `BREVO_API_KEY` | optional | For OTP email delivery |
| `GOOGLE_CLIENT_ID` | optional | For Google OAuth sign-in |
| `GOOGLE_CLIENT_SECRET` | optional | For Google OAuth sign-in |

---

## Deployment (Railway)

See [DEPLOY.md](./DEPLOY.md) for a full step-by-step Railway deployment guide.

```bash
railway login
railway up
```

---

## API Reference

### `POST /api/actions`
Submit an agent action for evaluation.

**Headers:** `Authorization: Bearer <token>`

**Body:**
```json
{
  "action_type": "send_email",
  "payload":     { "to": "user@example.com" },
  "context":     { "agent": "my-bot", "source": "cron" }
}
```

**Response:**
```json
{
  "verdict":     "ALLOW",
  "risk_score":  0.12,
  "action_id":   "act_abc123",
  "reason":      null,
  "proceed":     true,
  "approval_id": null
}
```

Verdicts: `ALLOW` | `PAUSE` | `BLOCK`

---

### `GET /health`
```json
{ "status": "ok", "version": "1.0.0", "timestamp": "2026-05-04T10:00:00.000Z" }
```

---

## Security

- Passwords hashed with PBKDF2-SHA256 (100,000 iterations + random salt)
- API keys stored in hashed form
- Per-workspace data isolation at DB level
- Login brute-force protection: 10 fails/15-min per email
- Signup rate limiting: 5 requests/hour per IP
- Actions rate limiting: 100 requests/hour per IP
- Security headers: X-Content-Type-Options, X-Frame-Options, HSTS, Referrer-Policy

---

## License

MIT © 2026 Allkinz — see [LICENSE](./LICENSE)
