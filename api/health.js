'use strict';
/**
 * api/health.js — Health check route
 */

module.exports = async function (fastify, opts) {
  fastify.get('/', async (request, reply) => {
    return { status: 'ok', service: 'agent-shield-core', version: '0.1.0' };
  });
};
