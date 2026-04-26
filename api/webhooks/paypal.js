'use strict';
/**
 * api/webhooks/paypal.js — POST /webhooks/paypal
 * No auth middleware — called by PayPal or directly by the frontend after approval.
 * Verifies order status via PayPal Orders API before activating subscription.
 */

const { supabaseAdmin } = require('../../services/supabase');
const { sendReceipt }   = require('../../services/brevo');

const PAYPAL_BASE = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live:    'https://api-m.paypal.com',
};

const PLAN_BY_USD = {
  '12.00': 'pro',
  '60.00': 'enterprise',
};

async function getPayPalToken() {
  const mode   = process.env.PAYPAL_MODE || 'sandbox';
  const base   = PAYPAL_BASE[mode] || PAYPAL_BASE.sandbox;
  const creds  = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString('base64');

  const res = await fetch(`${base}/v1/oauth2/token`, {
    method:  'POST',
    headers: {
      Authorization:  `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  return { token: data.access_token, base };
}

async function verifyOrder(orderId) {
  const { token, base } = await getPayPalToken();
  const res = await fetch(`${base}/v2/checkout/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`PayPal order lookup failed: ${res.status}`);
  return res.json();
}

module.exports = async function (fastify, opts) {
  fastify.post('/', async (request, reply) => {
    const { order_id, workspace_id, email, name } = request.body || {};

    if (!order_id || !workspace_id) {
      reply.code(400);
      return { error: 'order_id and workspace_id are required' };
    }

    let order;
    try {
      order = await verifyOrder(order_id);
    } catch (e) {
      request.log.error({ e: e.message }, 'PayPal order verification failed');
      reply.code(400);
      return { error: 'Order verification failed: ' + e.message };
    }

    if (order.status !== 'COMPLETED') {
      reply.code(400);
      return { error: `Order not completed — status: ${order.status}` };
    }

    const unit      = order.purchase_units?.[0];
    const amountUSD = unit?.amount?.value ?? '0.00';
    const planId    = PLAN_BY_USD[amountUSD] ?? 'pro';

    const periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    // Upsert subscription
    const { error: subErr } = await supabaseAdmin
      .from('subscriptions')
      .upsert({
        workspace_id,
        plan_id:          planId,
        status:           'active',
        paypal_order_id:  order_id,
        period_end:       periodEnd.toISOString(),
      }, { onConflict: 'workspace_id' });

    if (subErr) {
      request.log.error(subErr, 'Failed to upsert subscription');
      reply.code(500);
      return { error: 'Subscription update failed' };
    }

    // Insert invoice
    await supabaseAdmin.from('invoices').insert({
      workspace_id,
      plan_id:    planId,
      amount_usd: parseFloat(amountUSD),
      currency:   'USD',
      provider:   'paypal',
      payment_id: order_id,
    });

    // Send receipt
    const PLAN_NAMES = { pro: 'Pro', enterprise: 'Enterprise' };
    if (email) {
      await sendReceipt({
        email,
        name:       name || email,
        plan_name:  PLAN_NAMES[planId] ?? planId,
        amount:     `$${amountUSD}`,
        currency:   'USD',
        payment_id: order_id,
      }).catch(err => request.log.warn({ err }, 'Receipt email failed — non-blocking'));
    }

    request.log.info({ order_id, planId, workspace_id }, 'PayPal subscription activated');
    return { ok: true, plan_id: planId };
  });
};
