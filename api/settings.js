'use strict';
/**
 * api/settings.js
 *   GET  /api/settings — read user_settings from Supabase
 *   POST /api/settings — upsert user_settings; also updates process.env at runtime
 */

const authenticate     = require('../middleware/auth');
const { supabaseAdmin } = require('../services/supabase');

module.exports = async function (fastify, opts) {
  // ── GET /api/settings ────────────────────────────────────────
  fastify.get('/', { preHandler: authenticate }, async (request, reply) => {
    const { workspace_id } = request.user;

    const { data, error } = await supabaseAdmin
      .from('user_settings')
      .select('dry_run, telegram_bot_token, telegram_chat_id, updated_at')
      .eq('workspace_id', workspace_id)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = row not found
      request.log.error(error, 'Failed to fetch settings');
      reply.code(500);
      return { error: 'Failed to fetch settings' };
    }

    return {
      dry_run:             data?.dry_run             ?? true,
      telegram_bot_token:  data?.telegram_bot_token  ?? null,
      telegram_chat_id:    data?.telegram_chat_id    ?? null,
      updated_at:          data?.updated_at          ?? null,
    };
  });

  // ── POST /api/settings ───────────────────────────────────────
  fastify.post('/', { preHandler: authenticate }, async (request, reply) => {
    const { workspace_id } = request.user;
    const { dry_run, telegram_bot_token, telegram_chat_id } = request.body || {};

    const payload = {
      workspace_id,
      updated_at: new Date().toISOString(),
    };

    if (dry_run          !== undefined) payload.dry_run             = !!dry_run;
    if (telegram_bot_token !== undefined) payload.telegram_bot_token = telegram_bot_token || null;
    if (telegram_chat_id   !== undefined) payload.telegram_chat_id   = telegram_chat_id   || null;

    const { error } = await supabaseAdmin
      .from('user_settings')
      .upsert(payload, { onConflict: 'workspace_id' });

    if (error) {
      request.log.error(error, 'Failed to save settings');
      reply.code(500);
      return { error: 'Failed to save settings' };
    }

    // Propagate dry_run to the running process so shield.run() picks it up immediately
    if (dry_run !== undefined) {
      process.env.SHIELD_DRY_RUN = dry_run ? 'true' : 'false';
    }

    return { ok: true };
  });
};
