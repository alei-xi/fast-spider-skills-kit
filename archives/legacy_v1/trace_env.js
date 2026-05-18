// trace_env.js
// Phase 2+3: Self-healing env tracer — one shot, zero manual iteration.
//
// Runs the SDK inside a vm sandbox with auto-stubbing Proxies. When the SDK
// touches a property that doesn't exist, the proxy creates a plausible stub on
// the fly. If it still crashes, the script parses the error, injects the missing
// stub, and re-runs automatically (up to --max-rounds, default 8).
//
// On success, it outputs a ready-to-require fake_env.js stub to stdout.
//
// Usage:
//   node core/trace_env.js bundles/signer.js > bundles/fake_env.js
//   node core/trace_env.js --max-rounds 12 --init bundles/signer.js
//   node core/trace_env.js --no-stub bundles/signer.js    # trace only, no output

const fs = require('fs');
const vm = require('vm');

// ── CLI ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opts = { maxRounds: 8, init: false, outputStub: true };
const positional = [];

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--max-rounds') { opts.maxRounds = parseInt(args[++i], 10); }
    else if (args[i] === '--init') { opts.init = true; }
    else if (args[i] === '--no-stub') { opts.outputStub = false; }
    else { positional.push(args[i]); }
}

const sdkPath = positional[0];
if (!sdkPath) {
    console.error('usage: node core/trace_env.js [--max-rounds N] [--init] <sdk-file.js>');
    process.exit(2);
}

// ── Heuristics: guess a sensible default for a property name ─────────────────
function guessDefault(propName) {
    const s = String(propName);

    // Known-value booleans
    if (/^(webdriver|cookieEnabled|onLine|hidden|saveData|mobile|aborted|hasFocus)$/i.test(s)) return false;
    if (/^(charging)$/i.test(s)) return true;

    // Known-value numerics
    if (/^(hardwareConcurrency|deviceMemory)$/i.test(s)) return 8;
    if (/^(maxTouchPoints)$/i.test(s)) return 0;
    if (/^(width|availWidth)$/i.test(s)) return 1920;
    if (/^(height|availHeight)$/i.test(s)) return 1080;
    if (/^(colorDepth|pixelDepth)$/i.test(s)) return 24;
    if (/^(length)$/i.test(s)) return 0;
    if (/^(downlink)$/i.test(s)) return 10;
    if (/^(rtt)$/i.test(s)) return 50;
    if (/^(jsHeapSizeLimit)$/i.test(s)) return 4294705152;
    if (/^(totalJSHeapSize)$/i.test(s)) return 50000000;
    if (/^(usedJSHeapSize)$/i.test(s)) return 30000000;

    // Known-value strings
    if (/^(userAgent|appName|appCodeName|appVersion|platform|vendor|vendorSub|product|productSub|language|effectiveType|characterSet|charset|compatMode|contentType|domain|referrer|title|cookie|visibilityState|readyState|scrollRestoration|orientation|type)$/i.test(s)) return '';

    // Nested objects — return empty object (will be wrapped in proxy on next access)
    if (/^(navigator|document|screen|location|history|localStorage|sessionStorage|performance|crypto|connection|permissions|clipboard|userAgentData|plugins|mimeTypes|images|scripts|links|forms|styleSheets|all|head|body|documentElement|upload|timing|memory|battery|orientation|ancestorOrigins|subtle|signal|headers)$/i.test(s)) return {};

    // Constructor / class-like (capitalized)
    if (/^[A-Z]/.test(s) && s.length > 1) return function () {};

    // Verb-prefix → function
    if (/^(get|set|add|remove|create|delete|has|open|close|send|query|dispatch|append|attach|draw|fill|stroke|measure|begin|end|push|pop|shift|unshift|splice|slice|map|filter|reduce|forEach|find|includes|indexOf|join|split|replace|match|test|exec|encode|decode|parse|stringify|log|warn|error|info|debug|trace|clear|mark|now|random|floor|ceil|round|abs|max|min|pow|sqrt|keys|values|entries|assign|freeze|seal|define|prevent|init|sign|encrypt|decrypt|subscribe|listen|connect|disconnect|on|off|once|emit|trigger|handle|process|validate|verify|register|login|logout|refresh|revoke|apply|call|bind|then|catch|finally|resolve|reject|all|race|observe|unobserve|disconnect|post|put|patch|del|head|options|abort|override|flush|read|write|seek|truncate|lock|unlock|mount|unmount|load|unload|play|pause|stop|start|resume|suspend|reset|clear|dump|restore|save|backup|export|import|format|transform|convert|compose|decompose|digest|hash|checksum|hmac|cipher|decipher|sign|verify|derive|generate|exchange|wrap|unwrap)$/i.test(s)) return function () {};

    // on* handlers
    if (/^on[A-Z]/.test(s)) return null;

    // Common getter → function
    if (/^(toString|valueOf|toJSON|toLocaleString|toDataURL|toBlob|getContext|getImageData|putImageData|getParameter|getExtension|getSupportedExtensions|createShader|createProgram|createBuffer|shaderSource|compileShader|attachShader|linkProgram|useProgram|getShaderParameter|getProgramParameter|getShaderInfoLog|getProgramInfoLog|getBoundingClientRect|getElementById|getElementsByTagName|getElementsByClassName|getElementsByName|querySelector|querySelectorAll|getResponseHeader|getAllResponseHeaders|getRandomValues|randomUUID|getHighEntropyValues|getBattery|getEntries|getEntriesByType|getEntriesByName|createElement|createElementNS|createTextNode|createDocumentFragment|createEvent|createLinearGradient|createRadialGradient|addEventListener|removeEventListener|dispatchEvent|setRequestHeader|addColorStop|appendChild|removeChild|insertBefore|replaceChild|cloneNode|setAttribute|getAttribute|removeAttribute|hasAttribute|contains|compareDocumentPosition|isEqualNode|isSameNode|lookupNamespaceURI|lookupPrefix|normalize|hasOwnProperty|isPrototypeOf|propertyIsEnumerable|sendBeacon|requestAnimationFrame|cancelAnimationFrame|requestIdleCallback|cancelIdleCallback|queueMicrotask|setTimeout|clearTimeout|setInterval|clearInterval)$/i.test(s)) return function () {};

    // Fallback → function (most remaining are methods)
    return function () {};
}

// ── Self-healing proxy ───────────────────────────────────────────────────────
const traceLog = [];  // [{path, type, auto}]

function makeHealer(name, depth) {
    return {
        get(target, prop) {
            if (typeof prop === 'symbol') return Reflect.get(target, prop);
            const key = String(prop);
            const fullPath = name ? `${name}.${key}` : key;

            if (!(key in target)) {
                const g = guessDefault(key);
                target[key] = g;
                traceLog.push({ path: fullPath, type: typeof g, auto: true });
            }

            let v = target[key];

            // Wrap objects/functions so chained access is also auto-healing
            if (depth > 0 && v && (typeof v === 'object' || typeof v === 'function')) {
                if (v.__healer_wrapped) return v;
                try {
                    const p = new Proxy(v, makeHealer(fullPath, depth - 1));
                    try { v.__healer_wrapped = true; } catch {}
                    return p;
                } catch {
                    return v;
                }
            }
            return v;
        },
        set(target, prop, value) {
            const key = String(prop);
            const fullPath = name ? `${name}.${key}` : key;
            traceLog.push({ path: fullPath, type: typeof value, write: true });
            return Reflect.set(target, prop, value);
        },
        has(target, prop) {
            const key = String(prop);
            if (key in target) return true;
            // Auto-create so 'in' checks pass
            target[key] = guessDefault(key);
            return true;
        },
    };
}

// ── Error parser ─────────────────────────────────────────────────────────────
function parseMissingPath(err) {
    const msg = err.message;

    // "XXX is not defined"
    let m = msg.match(/^(\S+)\s+is\s+not\s+defined/);
    if (m) return { path: m[1], reason: 'not_defined' };

    // "Cannot read properties of undefined (reading 'YYY')"
    m = msg.match(/reading\s+'([^']+)'/);
    if (m) return { path: m[1], reason: 'read_of_undefined' };

    // "XXX.YYY is not a function"
    m = msg.match(/^([\w.]+)\s+is\s+not\s+a\s+function/);
    if (m) return { path: m[1], reason: 'not_a_function' };

    // "Cannot set properties of undefined (setting 'YYY')"
    m = msg.match(/setting\s+'([^']+)'/);
    if (m) return { path: m[1], reason: 'set_of_undefined' };

    // "Cannot read property 'YYY' of undefined" (older Node)
    m = msg.match(/property\s+'([^']+)'\s+of\s+undefined/);
    if (m) return { path: m[1], reason: 'read_of_undefined_old' };

    return null;
}

// ── Build initial sandbox ────────────────────────────────────────────────────
function buildSandbox() {
    const s = {};
    s.window = s;
    s.self = s;
    s.globalThis = s;
    s.top = s;
    s.parent = s;
    s.frames = s;
    s.console = console;

    // Seed browser globals as self-healing proxies (depth=2 covers navigator.connection.effectiveType)
    const globals = [
        'navigator', 'document', 'screen', 'location', 'history',
        'localStorage', 'sessionStorage', 'performance', 'crypto',
        'XMLHttpRequest', 'fetch', 'Headers', 'Request', 'Response',
        'FormData', 'Blob', 'URL', 'URLSearchParams',
        'AbortController', 'WebSocket', 'EventSource',
        'RTCPeerConnection', 'MediaSource', 'MessageChannel',
        'IntersectionObserver', 'MutationObserver', 'ResizeObserver', 'PerformanceObserver',
    ];

    for (const name of globals) {
        const base = guessDefault(name);
        s[name] = new Proxy(typeof base === 'function' ? base : (base || {}), makeHealer(name, 2));
    }

    // Anti-rehost
    s.process = undefined;
    s.Deno = undefined;
    s.require = undefined;
    s.global = undefined;
    s.module = undefined;
    s.__dirname = undefined;
    s.__filename = undefined;

    // Node builtins passed through
    s.setTimeout = setTimeout;
    s.clearTimeout = clearTimeout;
    s.setInterval = setInterval;
    s.clearInterval = clearInterval;
    s.queueMicrotask = queueMicrotask;

    // Math / JSON / etc
    s.Math = Math;
    s.Date = Date;
    s.JSON = JSON;
    s.Promise = Promise;
    s.Symbol = Symbol;
    s.Array = Array;
    s.Object = Object;
    s.Reflect = Reflect;
    s.Proxy = Proxy;
    s.Map = Map;
    s.Set = Set;
    s.WeakMap = WeakMap;
    s.WeakSet = WeakSet;
    s.Error = Error;
    s.TypeError = TypeError;
    s.RangeError = RangeError;
    s.SyntaxError = SyntaxError;
    s.Function = Function;
    s.RegExp = RegExp;
    s.parseInt = parseInt;
    s.parseFloat = parseFloat;
    s.isNaN = isNaN;
    s.isFinite = isFinite;
    s.encodeURIComponent = encodeURIComponent;
    s.decodeURIComponent = decodeURIComponent;
    s.encodeURI = encodeURI;
    s.decodeURI = decodeURI;
    s.atob = (x) => Buffer.from(x, 'base64').toString('binary');
    s.btoa = (x) => Buffer.from(x, 'binary').toString('base64');
    // TypedArrays
    s.Int8Array = Int8Array;
    s.Uint8Array = Uint8Array;
    s.Uint8ClampedArray = Uint8ClampedArray;
    s.Int16Array = Int16Array;
    s.Uint16Array = Uint16Array;
    s.Int32Array = Int32Array;
    s.Uint32Array = Uint32Array;
    s.Float32Array = Float32Array;
    s.Float64Array = Float64Array;
    s.ArrayBuffer = ArrayBuffer;
    s.DataView = DataView;

    return s;
}

// ── Patch a specific path into the sandbox ───────────────────────────────────
function injectPath(sandbox, path) {
    const parts = path.split('.');
    let node = sandbox;
    for (let i = 0; i < parts.length - 1; i++) {
        const k = parts[i];
        if (!(k in node) || node[k] === undefined || node[k] === null) {
            // Check if this key name suggests it should be a function
            node[k] = guessDefault(k);
        }
        // Re-wrap if plain object
        if (node[k] !== null && typeof node[k] === 'object' && !Array.isArray(node[k])) {
            try { node[k] = new Proxy(node[k], makeHealer(parts.slice(0, i + 1).join('.'), 2)); } catch {}
        }
        node = node[k];
    }
    const last = parts[parts.length - 1];
    if (!(last in node) || node[last] === undefined) {
        node[last] = guessDefault(last);
    }
}

// ── Main loop ────────────────────────────────────────────────────────────────
function run() {
    const src = fs.readFileSync(sdkPath, 'utf8');
    let sandbox = buildSandbox();
    let lastRoundStubs = traceLog.length;

    process.stderr.write(`SDK: ${sdkPath} (${src.length} bytes)\n`);

    for (let round = 1; round <= opts.maxRounds; round++) {
        process.stderr.write(`\n── Round ${round}/${opts.maxRounds} ──\n`);

        // Snapshot sandbox before this round (deep enough for top-level keys)
        const snapshot = {};
        for (const [k, v] of Object.entries(sandbox)) {
            try { snapshot[k] = typeof v === 'function' ? v : JSON.parse(JSON.stringify(v)); } catch { snapshot[k] = v; }
        }

        const ctx = vm.createContext(sandbox);
        try {
            vm.runInContext(src, ctx, { filename: sdkPath });
            process.stderr.write('OK — SDK loaded without throwing.\n');

            // Phase 4 probe
            if (opts.init) {
                try {
                    vm.runInContext(`(function(){
                        const x = new XMLHttpRequest();
                        x.open('GET', 'https://www.example.com/api/test?_t=1');
                        x.setRequestHeader('content-type', 'application/x-www-form-urlencoded');
                        x.send(null);
                        process.stderr.write('XHR probe: _url=' + JSON.stringify(String(x._url||'').slice(-100)) + '\\n');
                    })()`, ctx);
                } catch (e) {
                    process.stderr.write(`XHR probe error: ${e.message}\n`);
                }
            }
            break; // Success
        } catch (e) {
            process.stderr.write(`ERROR: ${e.message}\n`);

            const parsed = parseMissingPath(e);
            if (!parsed) {
                process.stderr.write(`(unrecognized error pattern — treating as fatal)\n`);
                process.stderr.write(e.stack?.split('\n').slice(0, 5).join('\n') + '\n');
                break;
            }

            // Special case: the error says "X is not defined" — inject at sandbox root
            if (parsed.reason === 'not_defined') {
                process.stderr.write(`  → root missing: ${parsed.path}\n`);
                sandbox[parsed.path] = guessDefault(parsed.path);
                if (typeof sandbox[parsed.path] === 'object') {
                    sandbox[parsed.path] = new Proxy(sandbox[parsed.path], makeHealer(parsed.path, 2));
                }
                continue;
            }

            // Find what chain was last touched and splice in the missing node
            const newStubs = traceLog.slice(lastRoundStubs).filter(e => e.auto);
            lastRoundStubs = traceLog.length;

            if (newStubs.length > 0) {
                process.stderr.write(`  → last auto-stub: ${newStubs[newStubs.length - 1].path} (${newStubs[newStubs.length - 1].type})\n`);
                process.stderr.write(`  → new stubs this round: ${newStubs.length}\n`);
            }

            // Try to infer from recent traces what needs fixing
            const lastFew = traceLog.slice(-20).filter(e => e.auto);
            if (lastFew.length > 0) {
                const last = lastFew[lastFew.length - 1];
                process.stderr.write(`  → last access before crash: ${last.path}\n`);
            }

            // Inject the error path
            injectPath(sandbox, parsed.path);
            process.stderr.write(`  → injected: ${parsed.path}\n`);
        }
    }

    // ── Summary ──────────────────────────────────────────────────────────────
    const uniques = new Map();
    for (const e of traceLog) {
        if (!uniques.has(e.path) || e.write) uniques.set(e.path, e);
    }

    process.stderr.write(`\n\nTotal unique accesses: ${uniques.size}\n`);
    process.stderr.write(`Auto-stubbed: ${[...uniques.values()].filter(e => e.auto).length}\n`);
    process.stderr.write(`Writes: ${[...uniques.values()].filter(e => e.write).length}\n`);

    // ── Generate stub ────────────────────────────────────────────────────────
    if (opts.outputStub) {
        generateStub(uniques);
    }
}

function generateStub(uniques) {
    const out = [];
    out.push(`// Auto-generated env stub for: ${path.basename(sdkPath)}`);
    out.push(`// Generated: ${new Date().toISOString()}`);
    out.push(`// Properties traced: ${uniques.size}`);
    out.push(`//`);
    out.push(`// REVIEW these before production: navigator.webdriver, navigator.plugins,`);
    out.push(`//   screen.width/height, canvas.toDataURL return values, crypto.getRandomValues.`);
    out.push(`//   The auto-stubber uses heuristics — verify against real browser DevTools.`);
    out.push('');
    out.push(`'use strict';`);
    out.push('');
    out.push(`function buildFakeBrowser(opts = {}) {`);
    out.push(`    const ua = opts.userAgent ||`);
    out.push(`        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';`);
    out.push(`    const href = opts.href || 'https://www.example.com/';`);
    out.push(`    const u = new URL(href);`);
    out.push('');
    out.push(`    const W = {};`);
    out.push(`    W.window = W; W.self = W; W.globalThis = W; W.top = W; W.parent = W; W.frames = W;`);
    out.push(`    W.console = opts.console || console;`);
    out.push('');

    // Group by top-level key
    const tree = {};
    for (const [path, entry] of uniques) {
        const top = path.split('.')[0];
        if (!tree[top]) tree[top] = [];
        tree[top].push({ path, ...entry });
    }

    const skip = new Set(['window', 'self', 'globalThis', 'top', 'parent', 'frames', 'console',
        'Math', 'Date', 'JSON', 'Promise', 'Symbol', 'Array', 'Object', 'Reflect', 'Proxy',
        'Map', 'Set', 'WeakMap', 'WeakSet', 'Error', 'TypeError', 'RangeError', 'SyntaxError',
        'Function', 'RegExp', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
        'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
        'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array',
        'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'ArrayBuffer', 'DataView',
        'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask',
        'atob', 'btoa', 'process', 'Deno', 'require', 'global', 'module',
    ]);

    for (const [group, entries] of Object.entries(tree).sort()) {
        if (skip.has(group)) continue;

        const leaf = entries.filter(e => !e.path.includes('.', group.length + 1));
        const deep = entries.filter(e => e.path.includes('.', group.length + 1));

        if (deep.length === 0 && leaf.length === 1) {
            out.push(`    W.${leaf[0].path} = ${valStr(leaf[0])};`);
        } else if (deep.length > 0 || leaf.length > 1) {
            out.push(`    W.${group} = {`);
            const seen = new Set();
            for (const e of deep) {
                const sub = e.path.slice(group.length + 1);
                const key = sub.split('.')[0];
                if (seen.has(key)) continue;
                seen.add(key);

                const direct = deep.find(d => d.path === `${group}.${key}`);
                const nested = deep.filter(d => d.path.startsWith(`${group}.${key}.`) && d.path.split('.').length === `${group}.${key}`.split('.').length + 1);

                if (direct) {
                    out.push(`        ${key}: ${valStr(direct)},`);
                } else if (nested.length > 0) {
                    out.push(`        ${key}: {`);
                    for (const n of nested) {
                        const nk = n.path.split('.').pop();
                        out.push(`            ${nk}: ${valStr(n)},`);
                    }
                    out.push(`        },`);
                } else {
                    out.push(`        ${key}: {},`);
                }
            }
            out.push(`    };`);
        }
        out.push('');
    }

    // Web platform classes
    out.push(`    // Web platform classes`);
    out.push(`    W.Headers = class Headers { constructor(i){this._h={};if(i)for(const[k,v]of Object.entries(i))this._h[k.toLowerCase()]=v;} get(k){return this._h[k.toLowerCase()]??null;} set(k,v){this._h[k.toLowerCase()]=v;} has(k){return k.toLowerCase() in this._h;} forEach(cb){for(const[k,v]of Object.entries(this._h))cb(v,k,this);} };`);
    out.push(`    W.Request = class Request { constructor(u,i={}){this.url=String(u);this.method=i.method||'GET';this.headers=new W.Headers(i.headers);} };`);
    out.push(`    W.Response = class Response { constructor(b,i={}){this.body=b;this.status=i.status||200;this.ok=this.status<400;this.headers=new W.Headers(i.headers);} async text(){return String(this.body||'');} async json(){return JSON.parse(this.body||'null');} };`);
    out.push(`    W.FormData = class FormData { append(){} get(){} };`);
    out.push(`    W.Blob = class Blob { constructor(p=[],o={}){this.size=p.reduce((n,x)=>n+(x?.length||0),0);this.type=o.type||'';} slice(){} };`);
    out.push(`    W.URL = require('url').URL;`);
    out.push(`    W.URLSearchParams = require('url').URLSearchParams;`);
    out.push(`    W.AbortController = class AbortController { constructor(){this.signal={aborted:false,addEventListener(){}};} abort(){this.signal.aborted=true;} };`);
    out.push('');
    out.push(`    // Observers`);
    out.push(`    W.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };`);
    out.push(`    W.MutationObserver = class { observe(){} disconnect(){} };`);
    out.push(`    W.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };`);
    out.push('');
    out.push(`    // XHR fake (no network)`);
    out.push(`    W.XMLHttpRequest = class XMLHttpRequest {`);
    out.push(`        constructor(){this.readyState=0;this.status=0;this.responseText='';this.response='';this.responseURL='';this._headers={};this._url=null;this.onreadystatechange=null;this.onload=null;this.onerror=null;this.upload={addEventListener(){}};}`);
    out.push(`        open(m,u,a=true){this._method=m;this._url=u;this._async=a;this.readyState=1;}`);
    out.push(`        setRequestHeader(k,v){this._headers[k.toLowerCase()]=v;}`);
    out.push(`        getResponseHeader(){return null;} getAllResponseHeaders(){return'';} addEventListener(e,fn){this['on'+e]=fn;} removeEventListener(){} abort(){} overrideMimeType(){}`);
    out.push(`        send(body){this._body=body;this.readyState=4;this.status=200;this.responseURL=this._url;this.responseText='{"data":{"d":""},"message":"success"}';this.response=this.responseText;try{this.onreadystatechange&&this.onreadystatechange();}catch{}try{this.onload&&this.onload();}catch{}}`);
    out.push(`    };`);
    out.push('');
    out.push(`    // fetch fake`);
    out.push(`    W.fetch = function(u,i){const url=typeof u==='string'?u:u.url;W.__lastFetchUrl=url;return Promise.resolve({ok:true,status:200,url,redirected:false,type:'basic',headers:{get:()=>null,has:()=>false,forEach:()=>{}},text:()=>Promise.resolve('{"message":"success"}'),json:()=>Promise.resolve({message:'success'}),arrayBuffer:()=>Promise.resolve(new ArrayBuffer(0)),blob:()=>Promise.resolve({}),clone(){return this;}});};`);
    out.push('');
    out.push(`    // Anti-rehost`);
    out.push(`    W.process = undefined;`);
    out.push(`    W.Deno = undefined;`);
    out.push(`    W.require = undefined;`);
    out.push(`    W.global = undefined;`);
    out.push(`    W.module = undefined;`);
    out.push('');
    out.push(`    // Standard globals`);
    out.push(`    W.Math = Math; W.Date = Date; W.JSON = JSON; W.Promise = Promise; W.Symbol = Symbol;`);
    out.push(`    W.Array = Array; W.Object = Object; W.Reflect = Reflect; W.Proxy = Proxy;`);
    out.push(`    W.Map = Map; W.Set = Set; W.WeakMap = WeakMap; W.WeakSet = WeakSet;`);
    out.push(`    W.Error = Error; W.TypeError = TypeError; W.RangeError = RangeError; W.SyntaxError = SyntaxError;`);
    out.push(`    W.Function = Function; W.RegExp = RegExp;`);
    out.push(`    W.parseInt = parseInt; W.parseFloat = parseFloat;`);
    out.push(`    W.isNaN = isNaN; W.isFinite = isFinite;`);
    out.push(`    W.encodeURIComponent = encodeURIComponent; W.decodeURIComponent = decodeURIComponent;`);
    out.push(`    W.encodeURI = encodeURI; W.decodeURI = decodeURI;`);
    out.push(`    W.atob = (s) => Buffer.from(s,'base64').toString('binary');`);
    out.push(`    W.btoa = (s) => Buffer.from(s,'binary').toString('base64');`);
    out.push(`    W.setTimeout = setTimeout; W.clearTimeout = clearTimeout;`);
    out.push(`    W.setInterval = setInterval; W.clearInterval = clearInterval;`);
    out.push(`    W.queueMicrotask = queueMicrotask;`);
    out.push('');
    out.push(`    return W;`);
    out.push(`}`);
    out.push('');
    out.push(`module.exports = { buildFakeBrowser };`);

    console.log(out.join('\n'));
}

function valStr(entry) {
    switch (entry.type) {
    case 'string': return `''`;
    case 'number': return '0';
    case 'boolean': return 'false';
    case 'function': return 'function(){}';
    default: return '{}';
    }
}

const path = require('path');

// ── Go ───────────────────────────────────────────────────────────────────────
run();
