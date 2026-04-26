'use strict';
/**
 * middleware/auth.js — Fastify preHandler: verify Supabase JWT
 * Attaches req.user = { id, email, workspace_id, plan_id, action_limit }
 * Auto-provisions workspace + subscription on first login.
 */

const { supabaseAdmin } = require('../services/supabase');

async function authenticate(request, reply) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Missing Authorization header' });
  }
  const token = authHeader.slice(7);

  // Validate token with Supabase
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) {
    return reply.code(401).send({ error: 'Invalid or expired token' });
  }

  // Look up workspace for this user
  let { data: workspace } = await supabaseAdmin
    .from('workspaces')
    .select('id')
    .eq('owner_id', user.id)
    .single();

  // Auto-provision workspace + free subscription on first API call
  if (!workspace) {
    const raw    = (user.email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '_');
    const wsId   = `ws_${raw}`;
    const wsName = user.user_metadata?.full_name || user.email.split('@')[0];

    const { data: newWs, error: wsErr } = await supabaseAdmin
      .from('workspaces')
      .insert({ id: wsId, name: wsName, owner_id: user.id })
      .select()
      .single();

    if (wsErr) {
      request.log.error({ wsErr }, 'Failed to create workspace');
      return reply.code(500).send({ error: 'Workspace provisioning failed' });
    }
    workspace = newWs;

    // Free subscription
    await supabaseAdmin.from('subscriptions').insert({
      workspace_id: wsId,
      plan_id: 'free',
      status: 'active',
    });

    // Default settings
    await supabaseAdmin.from('user_settings').insert({
      workspace_id: wsId,
      dry_run: true,
    });
  }

  // Fetch plan limits
  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('plan_id, plans(action_limit)')
    .eq('workspace_id', workspace.id)
    .single();

  request.user = {
    id:           user.id,
    email:        user.email,
    workspace_id: workspace.id,
    plan_id:      sub?.plan_id      ?? 'free',
    action_limit: sub?.plans?.action_limit ?? 500,
  };
}

module.exports = authenticate;
