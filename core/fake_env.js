// fake_env.js
// Phase 3: A reusable browser-environment patch for Node `vm` sandboxes.
// Covers what most JS signers (anti-crawl frameworks, JSVMP signers) probe.
// Adjust per Phase 2 trace findings — this is a starting point, not an oracle.
//
// Usage:
//   const { buildFakeBrowser } = require('./fake_env_template.js');
//   const realWindow = buildFakeBrowser({
//       userAgent: '<UA matching whatever the page uses>',
//       href:      'https://www.<your-target>.com/<page-where-XHR-fires>',
//   });
//   const ctx = require('vm').createContext(realWindow);
//   require('vm').runInContext(sdkSource, ctx);

'use strict';

function buildFakeBrowser(opts = {}) {
    const ua = opts.userAgent ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0';
    // Default href is a placeholder. Real targets MUST pass their own — many
    // signers read window.location.* and embed origin/hostname/pathname into
    // the signature. A wrong href silently produces wrong signatures.
    const href = opts.href || 'https://www.example.com/';
    const u = new URL(href);

    const W = {};            // the future window
    W.window = W;
    W.self = W;
    W.globalThis = W;
    W.top = W;
    W.parent = W;
    W.frames = W;
    W.console = console;

    // ------------ navigator ------------
    W.navigator = {
        userAgent: ua,
        appName: 'Netscape',
        appCodeName: 'Mozilla',
        appVersion: ua.replace(/^Mozilla\//, ''),
        platform: 'Win32',
        vendor: 'Google Inc.',
        vendorSub: '',
        product: 'Gecko',
        productSub: '20030107',
        language: 'zh-CN',
        languages: ['zh-CN', 'zh', 'en'],
        onLine: true,
        cookieEnabled: true,
        webdriver: false,
        hardwareConcurrency: 8,
        deviceMemory: 8,
        maxTouchPoints: 0,
        doNotTrack: null,
        plugins: { length: 5, item: () => null, namedItem: () => null },
        mimeTypes: { length: 2, item: () => null, namedItem: () => null },
        permissions: { query: () => Promise.resolve({ state: 'granted' }) },
        connection: {
            effectiveType: '4g', downlink: 10, rtt: 50, saveData: false,
            addEventListener() {}, removeEventListener() {},
        },
        userAgentData: {
            brands: [
                { brand: 'Chromium', version: '146' },
                { brand: 'Microsoft Edge', version: '146' },
            ],
            mobile: false, platform: 'Windows',
            getHighEntropyValues: () => Promise.resolve({}),
        },
        clipboard: { writeText: () => Promise.resolve() },
        sendBeacon: () => true,
        getBattery: () => Promise.resolve({ charging: true, level: 1 }),
    };

    // ------------ screen ------------
    W.screen = {
        width: 1920, height: 1080, availWidth: 1920, availHeight: 1040,
        colorDepth: 24, pixelDepth: 24, orientation: { type: 'landscape-primary', angle: 0 },
    };

    // ------------ location / history ------------
    W.location = {
        href, origin: u.origin, protocol: u.protocol, host: u.host, hostname: u.hostname,
        port: u.port, pathname: u.pathname, search: u.search, hash: u.hash,
        ancestorOrigins: { length: 0, item: () => null, contains: () => false },
        assign() {}, reload() {}, replace() {}, toString() { return href; },
    };
    W.history = {
        length: 1, scrollRestoration: 'auto', state: null,
        back() {}, forward() {}, go() {}, pushState() {}, replaceState() {},
    };

    // ------------ document ------------
    function makeElement(tag) {
        const el = {
            tagName: tag.toUpperCase(),
            nodeName: tag.toUpperCase(),
            nodeType: 1,
            children: [], childNodes: [], style: {}, dataset: {},
            attributes: {},
            getAttribute(k) { return this.attributes[k]; },
            setAttribute(k, v) { this.attributes[k] = v; },
            removeAttribute(k) { delete this.attributes[k]; },
            appendChild(c) { this.children.push(c); return c; },
            removeChild(c) { return c; },
            addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
            getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0 }),
            cloneNode() { return makeElement(tag); },
            innerHTML: '', innerText: '', textContent: '',
            click() {}, focus() {}, blur() {},
        };
        if (tag === 'canvas') {
            el.width = 300; el.height = 150;
            el.toDataURL = () => 'data:image/png;base64,iVBORw0KGgo=';   // stable
            el.toBlob = (cb) => cb({});
            el.getContext = (kind) => makeCanvasContext(kind);
        }
        if (tag === 'span') {
            el.offsetWidth = 50; el.offsetHeight = 12;
        }
        return el;
    }
    function makeCanvasContext(kind) {
        if (kind === '2d') {
            return {
                fillStyle: '#000', strokeStyle: '#000', font: '10px sans-serif',
                textBaseline: 'alphabetic', textAlign: 'start',
                fillRect() {}, strokeRect() {}, clearRect() {},
                fillText() {}, strokeText() {},
                measureText: (t) => ({ width: t.length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
                getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
                putImageData() {}, drawImage() {}, beginPath() {}, closePath() {},
                moveTo() {}, lineTo() {}, stroke() {}, fill() {},
                arc() {}, rect() {}, save() {}, restore() {}, translate() {}, scale() {}, rotate() {},
                createLinearGradient: () => ({ addColorStop() {} }),
                createRadialGradient: () => ({ addColorStop() {} }),
            };
        }
        if (kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl') {
            return {
                getParameter: (k) => {
                    const m = { 7936: 'WebKit', 7937: 'WebKit WebGL', 7938: 'WebGL 1.0' };
                    return m[k] || '';
                },
                getExtension: () => null,
                getSupportedExtensions: () => ['ANGLE_instanced_arrays', 'EXT_blend_minmax'],
                createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}),
                shaderSource() {}, compileShader() {}, attachShader() {}, linkProgram() {}, useProgram() {},
                getShaderParameter: () => true, getProgramParameter: () => true,
                getShaderInfoLog: () => '', getProgramInfoLog: () => '',
            };
        }
        return null;
    }

    const docHead = makeElement('head');
    const docBody = makeElement('body');
    W.document = {
        readyState: 'complete',
        characterSet: 'UTF-8', charset: 'UTF-8',
        compatMode: 'CSS1Compat',
        contentType: 'text/html',
        URL: href, documentURI: href, baseURI: href,
        domain: u.hostname, location: W.location,
        referrer: '',
        title: '',
        cookie: '',
        head: docHead, body: docBody,
        documentElement: makeElement('html'),
        images: [makeElement('img'), makeElement('img'), makeElement('img')],
        scripts: [], links: [], forms: [], styleSheets: [],
        all: { length: 0, item: () => null },
        createElement: (tag) => makeElement(tag),
        createElementNS: (ns, tag) => makeElement(tag),
        createTextNode: (t) => ({ nodeType: 3, textContent: t }),
        createDocumentFragment: () => makeElement('#fragment'),
        createEvent: () => ({ initEvent() {}, preventDefault() {}, stopPropagation() {} }),
        getElementById: () => null,
        getElementsByTagName: () => [],
        getElementsByClassName: () => [],
        getElementsByName: () => [],
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
        execCommand: () => true,
        hasFocus: () => true,
        hidden: false, visibilityState: 'visible',
    };

    // ------------ storage ------------
    function makeStorage() {
        const map = {};
        return {
            get length() { return Object.keys(map).length; },
            key: (i) => Object.keys(map)[i] || null,
            getItem: (k) => (k in map ? map[k] : null),
            setItem: (k, v) => { map[k] = String(v); },
            removeItem: (k) => { delete map[k]; },
            clear: () => { for (const k of Object.keys(map)) delete map[k]; },
        };
    }
    W.localStorage = makeStorage();
    W.sessionStorage = makeStorage();
    W.indexedDB = { open: () => ({ onsuccess: null, onerror: null }) };

    // ------------ crypto ------------
    const nodeCrypto = require('crypto');
    W.crypto = {
        getRandomValues: (arr) => { nodeCrypto.randomFillSync(arr); return arr; },
        randomUUID: () => nodeCrypto.randomUUID(),
        subtle: {
            digest: async (alg, data) => {
                const h = nodeCrypto.createHash(alg.replace('-', '').toLowerCase());
                h.update(Buffer.from(data));
                return h.digest().buffer;
            },
        },
    };

    // ------------ timers / RAF ------------
    W.setTimeout = setTimeout;
    W.clearTimeout = clearTimeout;
    W.setInterval = setInterval;
    W.clearInterval = clearInterval;
    W.queueMicrotask = queueMicrotask;
    W.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
    W.cancelAnimationFrame = clearTimeout;
    W.requestIdleCallback = (cb) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 1);
    W.cancelIdleCallback = clearTimeout;

    // ------------ performance ------------
    const perfStart = Date.now();
    W.performance = {
        now: () => Date.now() - perfStart,
        timeOrigin: perfStart,
        getEntries: () => [],
        getEntriesByType: () => [],
        getEntriesByName: () => [],
        mark() {}, measure() {},
        clearMarks() {}, clearMeasures() {},
        timing: { navigationStart: perfStart, loadEventEnd: perfStart + 1000 },
        memory: { jsHeapSizeLimit: 4_294_705_152, totalJSHeapSize: 50_000_000, usedJSHeapSize: 30_000_000 },
    };

    // ------------ standard web platform classes ------------
    W.Headers = class Headers {
        constructor(init) { this._h = {}; if (init) for (const [k, v] of Object.entries(init)) this._h[k.toLowerCase()] = v; }
        get(k) { return this._h[k.toLowerCase()] ?? null; }
        set(k, v) { this._h[k.toLowerCase()] = v; }
        has(k) { return k.toLowerCase() in this._h; }
        delete(k) { delete this._h[k.toLowerCase()]; }
        forEach(cb) { for (const [k, v] of Object.entries(this._h)) cb(v, k, this); }
    };
    W.Request = class Request { constructor(input, init = {}) { this.url = String(input); this.method = init.method || 'GET'; this.headers = new W.Headers(init.headers); this.body = init.body || null; } };
    W.Response = class Response { constructor(body, init = {}) { this.body = body; this.status = init.status || 200; this.ok = this.status < 400; this.headers = new W.Headers(init.headers); } async text() { return String(this.body || ''); } async json() { return JSON.parse(this.body || 'null'); } };
    W.FormData = class FormData { constructor() { this._d = []; } append(k, v) { this._d.push([k, v]); } get(k) { return (this._d.find((p) => p[0] === k) || [])[1]; } };
    W.Blob = class Blob { constructor(parts = [], opts = {}) { this.size = parts.reduce((n, p) => n + (p.length || 0), 0); this.type = opts.type || ''; } };
    W.URL = require('url').URL;
    W.URLSearchParams = require('url').URLSearchParams;
    W.AbortController = class AbortController { constructor() { this.signal = { aborted: false, addEventListener() {} }; } abort() { this.signal.aborted = true; } };

    // Observers (no-op but typeof === 'function')
    W.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
    W.MutationObserver = class { observe() {} disconnect() {} };
    W.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    W.PerformanceObserver = class { observe() {} disconnect() {} };

    W.WebSocket = class { constructor() { this.readyState = 0; } send() {} close() {} addEventListener() {} };
    W.EventSource = class { constructor() {} close() {} addEventListener() {} };
    W.RTCPeerConnection = function () {};
    W.MediaSource = function () {};
    W.MessageChannel = class { constructor() { this.port1 = { postMessage() {}, addEventListener() {} }; this.port2 = { postMessage() {}, addEventListener() {} }; } };

    // ------------ XHR fake (Phase 4) ------------
    W.XMLHttpRequest = class XMLHttpRequest {
        constructor() {
            this.readyState = 0;
            this.status = 0;
            this.responseText = '';
            this.response = '';
            this.responseURL = '';
            this._headers = {};
            this._url = null;
            this.onreadystatechange = null;
            this.onload = null;
            this.onerror = null;
            this.upload = { addEventListener() {}, removeEventListener() {} };
        }
        open(method, url, async = true) { this._method = method; this._url = url; this._async = async; this.readyState = 1; }
        setRequestHeader(k, v) { this._headers[k.toLowerCase()] = v; }
        getResponseHeader() { return null; }
        getAllResponseHeaders() { return ''; }
        addEventListener(ev, fn) { this['on' + ev] = fn; }
        removeEventListener() {}
        abort() {}
        overrideMimeType() {}
        send(body) {
            this._body = body;
            this.readyState = 4;
            this.status = 200;
            this.responseURL = this._url;
            this.responseText = '{"data":{"d":"","e":"","f":""},"message":"success","status_code":0}';
            this.response = this.responseText;
            try { this.onreadystatechange && this.onreadystatechange(); } catch {}
            try { this.onload && this.onload(); } catch {}
        }
    };

    // ------------ fetch fake ------------
    W.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : input.url;
        W.__lastFetchUrl = url;
        return Promise.resolve({
            ok: true, status: 200, url, redirected: false, type: 'basic',
            headers: { get: () => null, has: () => false, forEach: () => {} },
            text: () => Promise.resolve('{"message":"success"}'),
            json: () => Promise.resolve({ message: 'success' }),
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
            blob: () => Promise.resolve({}),
            clone() { return this; },
        });
    };

    // ------------ events ------------
    W.addEventListener = () => {};
    W.removeEventListener = () => {};
    W.dispatchEvent = () => true;
    W.postMessage = () => {};
    W.atob = (s) => Buffer.from(s, 'base64').toString('binary');
    W.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
    W.alert = () => {};
    W.confirm = () => true;
    W.prompt = () => null;
    W.open = () => null;

    // ------------ trip-wires for anti-rehost detection ------------
    W.process = undefined;
    W.Deno = undefined;
    W.require = undefined;
    W.global = undefined;
    W.module = undefined;

    // Misc
    W.Math = Math;
    W.Date = Date;
    W.JSON = JSON;
    W.Promise = Promise;
    W.Symbol = Symbol;
    W.Array = Array;
    W.Object = Object;
    W.Reflect = Reflect;
    W.Proxy = Proxy;
    W.Map = Map;
    W.Set = Set;
    W.WeakMap = WeakMap;
    W.WeakSet = WeakSet;
    W.Error = Error;
    W.TypeError = TypeError;
    W.RangeError = RangeError;
    W.SyntaxError = SyntaxError;
    W.Function = Function;
    W.RegExp = RegExp;
    W.parseInt = parseInt;
    W.parseFloat = parseFloat;
    W.isNaN = isNaN;
    W.isFinite = isFinite;
    W.encodeURIComponent = encodeURIComponent;
    W.decodeURIComponent = decodeURIComponent;
    W.encodeURI = encodeURI;
    W.decodeURI = decodeURI;

    return W;
}

module.exports = { buildFakeBrowser };
