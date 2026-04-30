'use strict';
/**
 * auth/google.js — Google OAuth2 helper for "Sign in with Google"
 *
 * Flow:
 *   1. Build authorization URL → redirect user to Google
 *   2. Exchange code for tokens
 *   3. Verify ID token and extract user info
 */

const { OAuth2Client } = require('google-auth-library');

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI;

// Allowed redirect URIs — must be registered in Google Cloud Console
const ALLOWED_REDIRECT_URIS = new Set([
  'https://zippy-spontaneity-production.up.railway.app/api/auth/google/callback',
  'https://www.allkinz.com/api/auth/google/callback',
  'https://allkinz.com/api/auth/google/callback',
  'http://localhost:3000/api/auth/google/callback',
  GOOGLE_REDIRECT_URI,
].filter(Boolean));

/**
 * Pick the best redirect URI for the given request hostname.
 * Falls back to GOOGLE_REDIRECT_URI env var.
 */
function resolveRedirectUri(hostname) {
  if (!hostname) return GOOGLE_REDIRECT_URI;
  const candidate = `https://${hostname}/api/auth/google/callback`;
  return ALLOWED_REDIRECT_URIS.has(candidate) ? candidate : GOOGLE_REDIRECT_URI;
}

// Reusable client
function getClient(redirectUri) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error('Google OAuth credentials not configured');
  }
  const uri = redirectUri || GOOGLE_REDIRECT_URI;
  if (!uri) throw new Error('Google OAuth redirect URI not configured');
  return new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, uri);
}

/**
 * Build the Google OAuth2 authorization URL
 */
function getAuthUrl(state, redirectUri) {
  const client = getClient(redirectUri);
  const url = client.generateAuthUrl({
    access_type: 'offline',
    scope:       ['openid', 'email', 'profile'],
    include_granted_scopes: true,
    prompt:      'select_account',
    state:       state || undefined,
  });
  return url;
}

/**
 * Exchange authorization code for tokens and verify the ID token
 * Returns: { email, email_verified, name, picture, hd }
 */
async function verifyCode(code, redirectUri) {
  const client = getClient(redirectUri);
  const { tokens } = await client.getToken(code);

  if (!tokens.id_token) {
    throw new Error('Google did not return an ID token');
  }

  // Verify the ID token
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();
  if (!payload) {
    throw new Error('Unable to verify Google ID token');
  }

  return {
    email:           payload.email,
    email_verified:  payload.email_verified === true,
    name:            payload.name,
    picture:         payload.picture,
    hd:              payload.hd || null, // hosted domain (e.g. "company.com")
  };
}

module.exports = {
  getAuthUrl,
  verifyCode,
  resolveRedirectUri,
};
