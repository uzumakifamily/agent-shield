'use strict';
/**
 * utils/jwt.js — Custom HMAC-SHA256 JWT helpers
 *
 * Format: base64url(payload) + "." + base64url(HMAC-SHA256 signature)
 * These are NOT standard JWTs — they use a simpler two-part scheme.
 */

const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'shield-dev-secret-change-in-prod';
const TOKEN_TTL  = 30 * 24 * 3600; // 30 days in seconds

/**
 * Create a signed token from a plain-object payload.
 * Adds iat + exp automatically.
 */
function makeToken(payload) {
  const now  = Math.floor(Date.now() / 1000);
  const full = { ...payload, iat: now, exp: now + TOKEN_TTL };
  const data = Buffer.from(JSON.stringify(full)).toString('base64url');
  const sig  = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

/**
 * Verify and decode a token.
 * Returns the payload object on success, or null on failure / expiry / tampering.
 */
function readToken(token) {
  try {
    const [data, sig] = (token || '').split('.');
    if (!data || !sig) return null;
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = { makeToken, readToken };
