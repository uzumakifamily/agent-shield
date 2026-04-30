'use strict';
/**
 * middleware/auth.js — Fastify preHandler: verify custom HMAC-SHA256 JWT
 *
 * Attaches request.user = { id, email, workspace_id, plan_id, action_limit }
 *
 * Token format (created by utils/jwt.js):
 *   base64url({ sub, email, workspace, plan, name, iat, exp }) + "." + base64url(HMAC)
 *
 * NOTE: These are NOT Supabase JWTs. The old Supabase-based auth has been
 * removed and replaced with this lightweight custom verifier.
 */

const { readToken } = require('../utils/jwt');

async function authenticate(request, reply) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Missing Authorization header' });
  }

  const token   = authHeader.slice(7);
  // TEMP DEBUG — remove after confirming fix
  const secret  = process.env.JWT_SECRET || 'FALLBACK';
  request.log.info({ secretFirst8: secret.substring(0, 8), tokenParts: token.split('.').length, tokenLen: token.length }, 'auth-debug');
  const payload = readToken(token);
  request.log.info({ payloadReceived: payload !== null }, 'auth-debug-result');

  if (!payload) {
    return reply.code(401).send({ error: 'Invalid or expired token' });
  }

  // Map JWT payload fields → request.user shape expected by all API routes
  request.user = {
    id:           payload.sub,
    email:        payload.email,
    workspace_id: payload.workspace,   // JWT stores as "workspace", APIs expect "workspace_id"
    plan_id:      payload.plan   || 'free',
    action_limit: -1,                  // -1 = unlimited; extend here if plan limits needed
  };
}

module.exports = authenticate;
