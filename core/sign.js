// sign.js — Persistent signer process (JSONL stdin/stdout protocol).
//
// Usage:
//   node core/sign.js --server --ua "<browser-UA>"
//
// The process starts, writes {"ready":true} to stdout, then loops:
//   <- {"id": <int>, "url": "<url>"}
//   -> {"id": <int>, "ok": true, "signed_url": "<url>"}
//   -> {"id": <int>, "ok": false, "error": "<message>"}
//
// Companion Python wrapper: core/persistent_signer.py
//
// This is a TEMPLATE. Before use you must:
//   1. Fill in your SDK loading logic (search for "TODO")
//   2. Set the correct init config (see Phase 5 in README)
//   3. Verify with a real HTTP roundtrip (Phase 7)

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const readline = require('readline');

// ── CLI ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opts = { server: false, ua: '' };

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--server') opts.server = true;
    else if (args[i] === '--ua' && args[i + 1]) opts.ua = args[++i];
}

const UA = opts.ua ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ── Load env stub ────────────────────────────────────────────────────────────
// Prefer the auto-generated stub from trace_env.js. Fall back to the manual template.
let buildFakeBrowser;
const autoStub = path.join(__dirname, '..', 'bundles', 'fake_env.js');
const manualStub = path.join(__dirname, 'fake_env.js');

if (fs.existsSync(autoStub)) {
    buildFakeBrowser = require(autoStub).buildFakeBrowser;
    process.stderr.write(`[signer] loaded env stub: ${autoStub}\n`);
} else {
    buildFakeBrowser = require(manualStub).buildFakeBrowser;
    process.stderr.write(`[signer] loaded env stub: ${manualStub}\n`);
}

// ── Build sandbox ────────────────────────────────────────────────────────────
function createSandbox(targetUrl) {
    const u = new URL(targetUrl);
    const realWindow = buildFakeBrowser({
        userAgent: UA,
        href: targetUrl,
    });

    const ctx = vm.createContext(realWindow);

    // TODO: Load your SDK source(s) into the sandbox.
    // Pattern:
    //   const sdkSrc = fs.readFileSync(path.join(__dirname, '..', 'bundles', 'your-signer.js'), 'utf8');
    //   vm.runInContext(sdkSrc, ctx, { filename: 'your-signer.js' });

    // TODO: Initialize the SDK with config copied verbatim from live DevTools.
    // Pattern:
    //   vm.runInContext(`(function(){
    //       window.__signer.init({
    //           appId: <number>,
    //           appKey: '<string>',
    //           paths: ['^/api/v1/'],
    //           debug: false,
    //       });
    //   })()`, ctx);

    return ctx;
}

// ── Sign a URL ───────────────────────────────────────────────────────────────
function sign(ctx, url) {
    const result = vm.runInContext(`(function(u){
        const x = new XMLHttpRequest();
        x.open('GET', u);
        x.setRequestHeader('content-type', 'application/x-www-form-urlencoded');
        x.send(null);
        return x._url || u;  // SDK hook rewrites _url with signed version
    })(${JSON.stringify(url)})`, ctx);

    return result;
}

// ── Server mode ──────────────────────────────────────────────────────────────
function runServer() {
    process.stderr.write(`[signer] UA: ${UA}\n`);

    let ctx = null;
    let lastTargetBase = '';

    const rl = readline.createInterface({ input: process.stdin });

    // Ready signal — persistent_signer.py waits for this
    process.stdout.write(JSON.stringify({ ready: true }) + '\n');

    rl.on('line', (line) => {
        let req;
        try { req = JSON.parse(line); } catch {
            process.stdout.write(JSON.stringify({ id: -1, ok: false, error: 'invalid json' }) + '\n');
            return;
        }

        const { id, url } = req;
        if (!url) {
            process.stdout.write(JSON.stringify({ id, ok: false, error: 'missing url' }) + '\n');
            return;
        }

        try {
            // Rebuild sandbox if target host changed (rare in practice)
            const targetBase = new URL(url).origin;
            if (!ctx || targetBase !== lastTargetBase) {
                ctx = createSandbox(url);
                lastTargetBase = targetBase;
            }

            const signedUrl = sign(ctx, url);
            process.stdout.write(JSON.stringify({ id, ok: true, signed_url: signedUrl }) + '\n');
        } catch (e) {
            process.stderr.write(`[signer] ERROR: ${e.message}\n`);
            process.stdout.write(JSON.stringify({ id, ok: false, error: e.message }) + '\n');
        }
    });

    rl.on('close', () => {
        process.stderr.write('[signer] stdin closed, exiting\n');
        process.exit(0);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => { process.exit(0); });
    process.on('SIGINT', () => { process.exit(0); });
}

// ── One-shot mode (for manual testing) ───────────────────────────────────────
function runOnce(url) {
    const ctx = createSandbox(url);
    const signed = sign(ctx, url);
    process.stdout.write(JSON.stringify({ ok: true, signed_url: signed }) + '\n');
    process.exit(0);
}

if (opts.server) {
    runServer();
} else {
    const targetUrl = process.argv[2] || 'https://www.example.com/api/test?_t=1';
    runOnce(targetUrl);
}
