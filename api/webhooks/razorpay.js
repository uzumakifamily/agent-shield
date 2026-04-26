'use strict';
/**
 * api/webhooks/razorpay.js — POST /webhooks/razorpay
 * No auth middleware — called by Razorpay servers.
 * Verifies X-Razorpay-Signature via HMAC-SHA256.
 * On payment.captured: upsert subscription, insert invoice, send receipt.
 */

const crypto            = require('crypto');
const { supabaseAdmin } = require('../../services/supabase');
const { sendReceipt }   = require('../../services/brevo');

const PLAN_BY_AMOUNT = {
  99900:  'pro',
  499900: 'enterprise',
};

module.exports = async function (fastify, opts) {
  // Capture raw body for HMAC verification before Fastify parses it
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    req.rawBody = body.toString('utf8');
    try {
      done(null, JSON.parse(req.rawBody));
    } catch (e) {
      done(e);
    }
  });

  fastify.post('/', async (request, reply) => {
    const secret    = process.env.RAZORPAY_KEY_SECRET;
    const signature = request.headers['x-razorpay-signature'];

    if (!secret || !signature) {
      reply.code(400);
      return { error: 'Missing signature or secret' };
    }

    // Verify HMAC
    const expected = crypto
      .createHmac('sha256', secret)
      .update(request.rawBody)
      .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      reply.code(400);
      return { error: 'Invalid signature' };
    }

    const event = request.body;
    request.log.info({ event: event.event }, 'Razorpay webhook received');

    if (event.event !== 'payment.captured') {
      return { ok: true, skipped: true };
    }

    const payment     = event.payload?.payment?.entity ?? {};
    const paymentId   = payment.id;
    const amount      = payment.amount; // paise
    const email       = payment.email;
    const planId      = PLAN_BY_AMOUNT[amount] ?? 'pro';
    const workspaceId = payment.notes?.workspace_id ?? null;

    if (!workspaceId) {
      request.log.warn({ paymentId }, 'Razorpay payment missing workspace_id in notes');
      return { ok: true, warn: 'workspace_id not in notes — subscription not updated' };
    }

    const periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    // Upsert subscription
    const { error: subErr } = await supabaseAdmin
      .from('subscriptions')
      .upsert({
        workspace_id:         workspaceId,
        plan_id:              planId,
        status:               'active',
        razorpay_payment_id:  paymentId,
        period_end:           periodEnd.toISOString(),
      }, { onConflict: 'workspace_id' });

    if (subErr) {
      request.log.error(subErr, 'Failed to upsert subscription');
      reply.code(500);
      return { error: 'Subscription update failed' };
    }

    // Insert invoice
    await supabaseAdmin.from('invoices').insert({
      workspace_id: workspaceId,
      plan_id:      planId,
      amount_inr:   amount,
      currency:     'INR',
      provider:     'razorpay',
      payment_id:   paymentId,
    });

    // Send receipt email
    if (email) {
      const PLAN_NAMES = { pro: 'Pro', enterprise: 'Enterprise' };
      await sendReceipt({
        email,
        name:       payment.contact ?? email,
        plan_name:  PLAN_NAMES[planId] ?? planId,
        amount:     `₹${(amount / 100).toFixed(0)}`,
        currency:   'INR',
        payment_id: paymentId,
      }).catch(err => request.log.warn({ err }, 'Receipt email failed — non-blocking'));
    }

    request.log.info({ paymentId, planId, workspaceId }, 'Subscription activated');
    return { ok: true };
  });
};
