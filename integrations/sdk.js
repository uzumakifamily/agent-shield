'use strict';
/**
 * integrations/sdk.js — Pattern A: SDK Decorator
 * Usage: const result = await shield.run(ctx, () => existingFn());
 */

const { run } = require('../brain/shield_kernel');

module.exports = { run };
