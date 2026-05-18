// src/env/index.js
// Compatibility wrapper — same { buildFakeBrowser } signature as core/fake_env.js.
//
// Drop-in replacement for sign.js:
//   // const { buildFakeBrowser } = require('./src/env');
//   // const realWindow = buildFakeBrowser({ userAgent: UA, href: targetUrl });
//   // const ctx = vm.createContext(realWindow);

'use strict';

const { buildFakeBrowser } = require('./browser');

module.exports = { buildFakeBrowser };
