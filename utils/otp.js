'use strict';
/**
 * utils/otp.js — OTP generation, validation, and rate-limiting
 */

const crypto = require('crypto');

// In-memory rate limit store: { email: { count, resetAt } }
const otpRateLimits = new Map();
const OTP_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const OTP_MAX_PER_WINDOW = 5;

/**
 * Generate a 6-digit numeric OTP
 */
function generateOtp() {
  // crypto.randomInt is inclusive on both ends
  return String(crypto.randomInt(100000, 999999 + 1));
}

/**
 * Check rate limit for OTP generation
 * Returns { ok: boolean, retryAfter?: number }
 */
function checkRateLimit(email) {
  const now = Date.now();
  const key = email.toLowerCase();
  const entry = otpRateLimits.get(key);

  if (!entry || now > entry.resetAt) {
    // Fresh window
    otpRateLimits.set(key, { count: 1, resetAt: now + OTP_WINDOW_MS });
    return { ok: true };
  }

  if (entry.count >= OTP_MAX_PER_WINDOW) {
    return { ok: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }

  entry.count += 1;
  return { ok: true };
}

/**
 * Validate an OTP against stored value and expiry
 * Returns { valid: boolean, reason?: string }
 */
function validateOtp(inputOtp, storedOtp, expiresAt) {
  if (!storedOtp || !expiresAt) {
    return { valid: false, reason: 'No OTP found. Please request a new code.' };
  }

  if (Date.now() > expiresAt) {
    return { valid: false, reason: 'OTP has expired. Please request a new code.' };
  }

  // Constant-time comparison to prevent timing attacks
  const inputBuf = Buffer.from(String(inputOtp).padStart(6, '0'));
  const storedBuf = Buffer.from(String(storedOtp).padStart(6, '0'));

  if (inputBuf.length !== storedBuf.length) {
    return { valid: false, reason: 'Invalid OTP.' };
  }

  let match = 0;
  for (let i = 0; i < inputBuf.length; i++) {
    match |= inputBuf[i] ^ storedBuf[i];
  }

  if (match !== 0) {
    return { valid: false, reason: 'Invalid OTP. Please try again.' };
  }

  return { valid: true };
}

module.exports = {
  generateOtp,
  checkRateLimit,
  validateOtp,
};
