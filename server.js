'use strict';
/**
 * server.js — Fastify entry point
 * Phase 2: adds CORS, authenticated API routes, and payment webhooks.
 * Existing /health and /approvals routes are UNCHANGED.
 */

require('dotenv').config();
const path = require('path');
const fastify = require('fastify')({ logger: true });

const PORT         = process.env.PORT         || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || '*';

// ── CORS ──────────────────────────────────────────────────────
// Applied to every request before routing
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
