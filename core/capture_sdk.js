// capture_sdk.js
// Phase 1: Automatically capture JS signing bundles from a live page via Playwright.
//
// Usage:
//   npx playwright install chromium
//   node core/capture_sdk.js --url "https://www.<target>.com/" [--out bundles/] [--timeout 30000]
//
// Options:
//   --url       Target page URL (required)
//   --out       Output directory for bundles (default: bundles/)
//   --timeout   Extra wait time after load in ms (default: 10000)
//   --ua        Custom User-Agent string
//   --pattern   Regex to filter JS URLs (default: broad anti-crawl/signer hints)
//   --min-size  Minimum JS file size in bytes (default: 20000)
//   --cookie    Cookie string to inject before navigation (optional)
//   --screenshot  Save a screenshot before closing (for debugging)

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

async function main() {
    const args = parseArgs();
    const outDir = path.resolve(args.out || 'bundles');
    fs.mkdirSync(outDir, { recursive: true });

    const url = args.url;
    if (!url) {
        console.error('ERROR: --url is required');
        process.exit(2);
    }

    const minSize = parseInt(args['min-size'] || '20000', 10);
    const extraWait = parseInt(args.timeout || '10000', 10);
    const nameHint = new RegExp(args.pattern || defaultPattern, 'i');
    const ua = args.ua || defaultUA;

    console.log(`Launching browser → ${url}`);
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ userAgent: ua });

    if (args.cookie) {
        // Format: "name1=val1; name2=val2"
        const cookies = args.cookie.split(';').map(pair => {
            const [name, ...rest] = pair.trim().split('=');
            return { name: name.trim(), value: rest.join('=').trim(), domain: new URL(url).hostname, path: '/' };
        });
        await context.addCookies(cookies);
    }

    const page = await context.newPage();
    const captured = {};

    page.on('response', async (resp) => {
        const respUrl = resp.url();
        if (!/\.js(?:\?|$)/.test(respUrl)) return;
        try {
            const body = await resp.body();
            if (body.length < minSize && !nameHint.test(respUrl)) return;
            const fileName = respUrl.split('/').pop().split('?')[0] || 'bundle.js';
            const unique = captured[fileName] ? `${Object.keys(captured).length}_${fileName}` : fileName;
            fs.writeFileSync(path.join(outDir, unique), body);
            captured[unique] = {
                url: respUrl,
                size: body.length,
                sha256: crypto.createHash('sha256').update(body).digest('hex'),
            };
            console.log(`  saved ${unique} (${body.length} bytes)`);
        } catch (e) {
            process.stderr.write(`  skip: ${respUrl} (${e.message})\n`);
        }
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    console.log(`Page loaded, waiting ${extraWait}ms for deferred JS...`);
    await page.waitForTimeout(extraWait);

    if (args.screenshot) {
        await page.screenshot({ path: path.join(outDir, 'page.png'), fullPage: true });
        console.log('  screenshot saved to bundles/page.png');
    }

    const cookieData = await context.cookies();
    const cookies = cookieData.map(c => `${c.name}=${c.value}`).join('; ');

    await browser.close();

    // Write manifest
    const manifest = {
        captured_at: new Date().toISOString(),
        from: url,
        user_agent: ua,
        cookies,
        files: captured,
    };
    fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`\nDone: ${Object.keys(captured).length} files saved to ${outDir}/`);
    console.log(`Manifest: ${outDir}/manifest.json`);
    console.log(`Cookies captured: ${cookies.slice(0, 80)}...`);
}

const defaultPattern = '(vmp|protect|crawler|risk|sec|sdk|runtime|bundler|glue|loader|sign|guard|shield)';

const defaultUA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

function parseArgs() {
    const argv = process.argv.slice(2);
    const result = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith('--')) {
            const key = arg.slice(2);
            const next = argv[i + 1];
            if (next && !next.startsWith('--')) {
                result[key] = next;
                i++;
            } else {
                result[key] = true;
            }
        }
    }
    return result;
}

main().catch(e => {
    console.error('FATAL:', e.message);
    process.exit(1);
});
