# Agent Shield Core

Canonical trust kernel for AI agents. Hook-based architecture. Multi-tenant.

## Architecture

- **brain/shield_kernel.js** — 3 hooks + run() entry point
- **db/** — better-sqlite3 layer + 5-table schema
- **utils/** — risk scoring, PII redaction, cost estimation, Telegram alerts
- **api/** — minimal route stubs (health, approvals)
- **integrations/** — Pattern A (sdk), B (proxy), C (webhook) stubs

## Quick Start

```bash
npm install
cp .env.example .env
npm test        # run smoke tests
npm run dev     # start Fastify server
```

## Usage

```js
const shield = require('./integrations/sdk');

await shield.run({
  workspaceId: 'ws_allkinz',
  projectId:   'proj_cold_email',
  agent:       'cold_email_bot',
  actionType:  'send_email',
  source:      'cron',
  payload:     { to: lead.email, subject }
}, () => sendEmail(lead.email, subject, body));
```

## Frozen

- Dashboard UI
- Billing / Stripe
- Auth flows
- Proxy + webhook full implementations
- Evals, metrics, policy DSL CRUD

Unlocked only when an external developer says "I need this. Where do I pay?"

## License

MIT © Allkinz
