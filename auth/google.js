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

// Reusable client
function getClient() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    throw new Error('Google OAuth credentials not configured');
  }
  return new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

/**
 * Build the Google OAuth2 authorization URL
 */
function getAuthUrl(state) {
  const client = getClient();
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
async function verifyCode(code) {
  const client = getClient();
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
};
