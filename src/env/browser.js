// src/env/browser.js
// Full browser window assembler using the prototype engine.
//
// Produces a window object that can serve as a drop-in replacement for the
// return value of core/fake_env.js.  Compatible with sign.js — just swap the
// require() and call buildFakeBrowser(opts).
//
// Usage (in sign.js):
//   // const { buildFakeBrowser } = require('../src/env/browser');
//   // const realWindow = buildFakeBrowser({ userAgent: UA, href: targetUrl });
//   // const ctx = vm.createContext(realWindow);
//
// Exports the same { buildFakeBrowser } signature as core/fake_env.js.

'use strict';

const { safefunction } = require('./utils');
const { PrototypeBuilder } = require('./prototype');
const { Window, createWindow } = require('./core');
const { buildNavigator } = require('./navigator');
const { createDocumentAll } = require('./document-all');
const { createCanvas: createFpCanvas, createWebGLContext, createAudioContext } = require('./fingerprint');

const pb = new PrototypeBuilder({ debug: false });

// ══════════════════════════════════════════════════════════════════════════════
// Sub-builders
// ══════════════════════════════════════════════════════════════════════════════

function buildScreen() {
    const screen = {};
    pb.defineReadOnly(screen, 'width', 1920);
    pb.defineReadOnly(screen, 'height', 1080);
    pb.defineReadOnly(screen, 'availWidth', 1920);
    pb.defineReadOnly(screen, 'availHeight', 1040);
    pb.defineReadOnly(screen, 'colorDepth', 24);
    pb.defineReadOnly(screen, 'pixelDepth', 24);
    pb.defineGetter(screen, 'orientation', () => ({ type: 'landscape-primary', angle: 0 }));
    return screen;
}

function buildLocation(href) {
    const u = new URL(href);
    const loc = {};
    pb.defineGetter(loc, 'href', () => u.href);
    pb.defineReadOnly(loc, 'origin', u.origin);
    pb.defineReadOnly(loc, 'protocol', u.protocol);
    pb.defineReadOnly(loc, 'host', u.host);
    pb.defineReadOnly(loc, 'hostname', u.hostname);
    pb.defineReadOnly(loc, 'port', u.port);
    pb.defineReadOnly(loc, 'pathname', u.pathname);
    pb.defineReadOnly(loc, 'search', u.search);
    pb.defineReadOnly(loc, 'hash', u.hash);
    pb.defineReadOnly(loc, 'ancestorOrigins', { length: 0 });
    loc.assign = safefunction(function () {}, 'assign', 1);
    loc.reload = safefunction(function () {}, 'reload', 0);
    loc.replace = safefunction(function () {}, 'replace', 1);
    loc.toString = safefunction(function toString() { return u.href; }, 'toString', 0);
    return loc;
}

function buildHistory() {
    const hist = {};
    pb.defineReadOnly(hist, 'length', 1);
    pb.defineReadOnly(hist, 'scrollRestoration', 'auto');
    pb.defineReadOnly(hist, 'state', null);
    hist.back = safefunction(function () {}, 'back', 0);
    hist.forward = safefunction(function () {}, 'forward', 0);
    hist.go = safefunction(function () {}, 'go', 0);
    hist.pushState = safefunction(function () {}, 'pushState', 3);
    hist.replaceState = safefunction(function () {}, 'replaceState', 3);
    return hist;
}

function buildDocument(href, opts) {
    opts = opts || {};
    const fpSeed = opts.canvasSeed || 0;
    const u = new URL(href);
    const doc = {};

    // Properties
    pb.defineReadOnly(doc, 'readyState', 'complete');
    pb.defineReadOnly(doc, 'characterSet', 'UTF-8');
    pb.defineReadOnly(doc, 'charset', 'UTF-8');
    pb.defineReadOnly(doc, 'compatMode', 'CSS1Compat');
    pb.defineReadOnly(doc, 'contentType', 'text/html');
    pb.defineReadOnly(doc, 'URL', href);
    pb.defineReadOnly(doc, 'documentURI', href);
    pb.defineReadOnly(doc, 'baseURI', href);
    pb.defineReadOnly(doc, 'domain', u.hostname);
    pb.defineReadOnly(doc, 'referrer', '');
    pb.defineReadOnly(doc, 'title', '');
    // cookie uses getter/setter — need writable for beforeParse hook
    let _cookie = '';
    Object.defineProperty(doc, 'cookie', {
        get() { return _cookie; },
        set(v) { _cookie = String(v); },
        enumerable: false,
        configurable: false,
    });
    pb.defineReadOnly(doc, 'hidden', false);
    pb.defineReadOnly(doc, 'visibilityState', 'visible');

    // Head / Body stubs
    const head = _makeElement('head', fpSeed);
    const body = _makeElement('body', fpSeed);
    pb.defineReadOnly(doc, 'head', head);
    pb.defineReadOnly(doc, 'body', body);
    pb.defineReadOnly(doc, 'documentElement', _makeElement('html', fpSeed));

    // Collections
    pb.defineReadOnly(doc, 'images', []);
    pb.defineReadOnly(doc, 'scripts', []);
    pb.defineReadOnly(doc, 'links', []);
    pb.defineReadOnly(doc, 'forms', []);
    pb.defineReadOnly(doc, 'styleSheets', []);

    // document.all — callable proxy, monitor-aware
    const docAll = createDocumentAll({ monitor: opts.debugAll || false });
    pb.defineReadOnly(doc, 'all', docAll);

    // Methods — close over fpSeed for canvas creation
    const _seed = fpSeed;
    doc.createElement = safefunction(function createElement(tag) {
        return _makeElement(String(tag).toLowerCase(), _seed);
    }, 'createElement', 1);
    doc.createElementNS = safefunction(function (ns, tag) { return _makeElement(tag, _seed); }, 'createElementNS', 2);
    doc.createTextNode = safefunction(function (t) { return { nodeType: 3, textContent: String(t) }; }, 'createTextNode', 1);
    doc.createDocumentFragment = safefunction(function () { return _makeElement('#fragment'); }, 'createDocumentFragment', 0);
    doc.createEvent = safefunction(function () {
        return { initEvent() {}, preventDefault() {}, stopPropagation() {} };
    }, 'createEvent', 1);
    doc.getElementById = safefunction(function () { return null; }, 'getElementById', 1);
    doc.getElementsByTagName = safefunction(function () { return []; }, 'getElementsByTagName', 1);
    doc.getElementsByClassName = safefunction(function () { return []; }, 'getElementsByClassName', 1);
    doc.getElementsByName = safefunction(function () { return []; }, 'getElementsByName', 1);
    doc.querySelector = safefunction(function () { return null; }, 'querySelector', 1);
    doc.querySelectorAll = safefunction(function () { return []; }, 'querySelectorAll', 1);
    doc.addEventListener = safefunction(function () {}, 'addEventListener', 3);
    doc.removeEventListener = safefunction(function () {}, 'removeEventListener', 3);
    doc.dispatchEvent = safefunction(function () { return true; }, 'dispatchEvent', 1);
    doc.hasFocus = safefunction(function hasFocus() { return true; }, 'hasFocus', 0);
    doc.execCommand = safefunction(function execCommand() { return true; }, 'execCommand', 2);

    return doc;
}

function _makeElement(tag, seed) {
    const el = {};
    pb.defineReadOnly(el, 'tagName', tag.toUpperCase());
    pb.defineReadOnly(el, 'nodeName', tag.toUpperCase());
    pb.defineReadOnly(el, 'nodeType', 1);
    pb.defineReadOnly(el, 'children', []);
    pb.defineReadOnly(el, 'childNodes', []);
    pb.defineReadOnly(el, 'style', {});
    pb.defineReadOnly(el, 'dataset', {});
    pb.defineReadOnly(el, 'attributes', {});
    pb.defineReadOnly(el, 'innerHTML', '');
    pb.defineReadOnly(el, 'innerText', '');
    pb.defineReadOnly(el, 'textContent', '');
    pb.defineReadOnly(el, 'className', '');

    el.getAttribute = safefunction(function getAttribute(k) { return this.attributes[k]; }, 'getAttribute', 1);
    el.setAttribute = safefunction(function setAttribute(k, v) { this.attributes[k] = v; }, 'setAttribute', 2);
    el.removeAttribute = safefunction(function removeAttribute(k) { delete this.attributes[k]; }, 'removeAttribute', 1);
    el.addEventListener = safefunction(function () {}, 'addEventListener', 3);
    el.removeEventListener = safefunction(function () {}, 'removeEventListener', 3);
    el.dispatchEvent = safefunction(function () { return true; }, 'dispatchEvent', 1);
    el.appendChild = safefunction(function (c) { this.children.push(c); return c; }, 'appendChild', 1);
    el.removeChild = safefunction(function (c) { return c; }, 'removeChild', 1);
    el.cloneNode = safefunction(function cloneNode() { return _makeElement(tag); }, 'cloneNode', 1);
    el.getBoundingClientRect = safefunction(function () {
        return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0 };
    }, 'getBoundingClientRect', 0);
    el.click = safefunction(function () {}, 'click', 0);
    el.focus = safefunction(function () {}, 'focus', 0);
    el.blur = safefunction(function () {}, 'blur', 0);

    // Canvas-specific — use fingerprint engine for seed-consistent output
    if (tag === 'canvas') {
        const fpCanvas = createFpCanvas(seed || 0);
        pb.defineReadOnly(el, 'width', fpCanvas.width);
        pb.defineReadOnly(el, 'height', fpCanvas.height);
        el.toDataURL = fpCanvas.toDataURL;
        el.toBlob = fpCanvas.toBlob;
        el.getContext = safefunction(function getContext(kind) {
            if (kind === '2d') {
                const ctx2d = fpCanvas.getContext('2d');
                // Preserve ctx properties for test compatibility
                ctx2d.fillStyle = '#000';
                ctx2d.strokeStyle = '#000';
                ctx2d.font = '10px sans-serif';
                return ctx2d;
            }
            if (kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl') {
                return createWebGLContext(seed || 0, kind === 'webgl2' ? 'webgl2' : 'webgl');
            }
            return null;
        }, 'getContext', 1);
    }

    return el;
}

function _makeCanvasContext(kind) {
    if (kind === '2d') {
        const ctx = {};
        ctx.fillStyle = '#000';
        ctx.strokeStyle = '#000';
        ctx.font = '10px sans-serif';
        ctx.fillRect = safefunction(function () {}, 'fillRect', 4);
        ctx.strokeRect = safefunction(function () {}, 'strokeRect', 4);
        ctx.clearRect = safefunction(function () {}, 'clearRect', 4);
        ctx.fillText = safefunction(function () {}, 'fillText', 3);
        ctx.strokeText = safefunction(function () {}, 'strokeText', 3);
        ctx.measureText = safefunction(function measureText(t) {
            return { width: t.length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 };
        }, 'measureText', 1);
        ctx.getImageData = safefunction(function (x, y, w, h) {
            return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
        }, 'getImageData', 4);
        ctx.putImageData = safefunction(function () {}, 'putImageData', 3);
        ctx.drawImage = safefunction(function () {}, 'drawImage', 3);
        ctx.beginPath = safefunction(function () {}, 'beginPath', 0);
        ctx.closePath = safefunction(function () {}, 'closePath', 0);
        ctx.moveTo = safefunction(function () {}, 'moveTo', 2);
        ctx.lineTo = safefunction(function () {}, 'lineTo', 2);
        ctx.stroke = safefunction(function () {}, 'stroke', 0);
        ctx.fill = safefunction(function () {}, 'fill', 0);
        ctx.arc = safefunction(function () {}, 'arc', 5);
        ctx.rect = safefunction(function () {}, 'rect', 4);
        ctx.save = safefunction(function () {}, 'save', 0);
        ctx.restore = safefunction(function () {}, 'restore', 0);
        ctx.translate = safefunction(function () {}, 'translate', 2);
        ctx.scale = safefunction(function () {}, 'scale', 2);
        ctx.rotate = safefunction(function () {}, 'rotate', 1);
        ctx.createLinearGradient = safefunction(function () {
            return { addColorStop() {} };
        }, 'createLinearGradient', 4);
        ctx.createRadialGradient = safefunction(function () {
            return { addColorStop() {} };
        }, 'createRadialGradient', 6);
        return ctx;
    }
    if (kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl') {
        const ctx = {};
        ctx.getParameter = safefunction(function getParameter(k) {
            const m = { 7936: 'WebKit', 7937: 'WebKit WebGL', 7938: 'WebGL 1.0' };
            return m[k] || '';
        }, 'getParameter', 1);
        ctx.getExtension = safefunction(function () { return null; }, 'getExtension', 1);
        ctx.getSupportedExtensions = safefunction(function () {
            return ['ANGLE_instanced_arrays', 'EXT_blend_minmax'];
        }, 'getSupportedExtensions', 0);
        ctx.createShader = safefunction(function () { return {}; }, 'createShader', 1);
        ctx.createProgram = safefunction(function () { return {}; }, 'createProgram', 0);
        ctx.createBuffer = safefunction(function () { return {}; }, 'createBuffer', 0);
        ctx.shaderSource = safefunction(function () {}, 'shaderSource', 2);
        ctx.compileShader = safefunction(function () {}, 'compileShader', 1);
        ctx.attachShader = safefunction(function () {}, 'attachShader', 2);
        ctx.linkProgram = safefunction(function () {}, 'linkProgram', 1);
        ctx.useProgram = safefunction(function () {}, 'useProgram', 1);
        ctx.getShaderParameter = safefunction(function () { return true; }, 'getShaderParameter', 2);
        ctx.getProgramParameter = safefunction(function () { return true; }, 'getProgramParameter', 2);
        ctx.getShaderInfoLog = safefunction(function () { return ''; }, 'getShaderInfoLog', 1);
        ctx.getProgramInfoLog = safefunction(function () { return ''; }, 'getProgramInfoLog', 1);
        return ctx;
    }
    return null;
}

function buildStorage() {
    function makeStorage() {
        const map = {};
        const s = {};
        pb.defineGetter(s, 'length', function () { return Object.keys(map).length; });
        s.key = safefunction(function key(i) { return Object.keys(map)[i] || null; }, 'key', 1);
        s.getItem = safefunction(function getItem(k) { return k in map ? map[k] : null; }, 'getItem', 1);
        s.setItem = safefunction(function setItem(k, v) { map[k] = String(v); }, 'setItem', 2);
        s.removeItem = safefunction(function removeItem(k) { delete map[k]; }, 'removeItem', 1);
        s.clear = safefunction(function clear() { for (const k of Object.keys(map)) delete map[k]; }, 'clear', 0);
        return s;
    }
    return { local: makeStorage(), session: makeStorage() };
}

function buildPerformance() {
    const start = Date.now();
    const perf = {};
    pb.defineReadOnly(perf, 'timeOrigin', start);
    perf.now = safefunction(function now() { return Date.now() - start; }, 'now', 0);
    perf.getEntries = safefunction(function () { return []; }, 'getEntries', 0);
    perf.getEntriesByType = safefunction(function () { return []; }, 'getEntriesByType', 1);
    perf.getEntriesByName = safefunction(function () { return []; }, 'getEntriesByName', 1);
    perf.mark = safefunction(function () {}, 'mark', 1);
    perf.measure = safefunction(function () {}, 'measure', 3);
    perf.clearMarks = safefunction(function () {}, 'clearMarks', 0);
    perf.clearMeasures = safefunction(function () {}, 'clearMeasures', 0);
    pb.defineReadOnly(perf, 'timing', { navigationStart: start, loadEventEnd: start + 1000 });
    pb.defineReadOnly(perf, 'memory', {
        jsHeapSizeLimit: 4294705152,
        totalJSHeapSize: 50000000,
        usedJSHeapSize: 30000000,
    });
    return perf;
}

function buildCrypto() {
    const nodeCrypto = require('crypto');
    const crypto = {};
    crypto.getRandomValues = safefunction(function getRandomValues(arr) {
        nodeCrypto.randomFillSync(arr);
        return arr;
    }, 'getRandomValues', 1);
    crypto.randomUUID = safefunction(function randomUUID() {
        return nodeCrypto.randomUUID();
    }, 'randomUUID', 0);
    crypto.subtle = {
        digest: safefunction(async function digest(alg, data) {
            const h = nodeCrypto.createHash(alg.replace('-', '').toLowerCase());
            h.update(Buffer.from(data));
            return h.digest().buffer;
        }, 'digest', 2),
    };
    return crypto;
}

function buildXMLHttpRequest() {
    function XMLHttpRequest() {}
    safefunction(XMLHttpRequest, 'XMLHttpRequest', 0);

    XMLHttpRequest.prototype = {
        get readyState() { return this._readyState || 0; },
        get status() { return this._status || 0; },
        get responseText() { return this._responseText || ''; },
        get response() { return this._response || ''; },
        get responseURL() { return this._responseURL || ''; },
        open: safefunction(function open(method, url) {
            this._method = method;
            this._url = url;
            this._readyState = 1;
            this._headers = {};
        }, 'open', 2),
        setRequestHeader: safefunction(function setRequestHeader(k, v) {
            if (!this._headers) this._headers = {};
            this._headers[k.toLowerCase()] = v;
        }, 'setRequestHeader', 2),
        getResponseHeader: safefunction(function () { return null; }, 'getResponseHeader', 1),
        getAllResponseHeaders: safefunction(function () { return ''; }, 'getAllResponseHeaders', 0),
        addEventListener: safefunction(function (ev, fn) { this['on' + ev] = fn; }, 'addEventListener', 2),
        removeEventListener: safefunction(function () {}, 'removeEventListener', 2),
        abort: safefunction(function () {}, 'abort', 0),
        overrideMimeType: safefunction(function () {}, 'overrideMimeType', 1),
        send: safefunction(function send(body) {
            this._body = body;
            this._readyState = 4;
            this._status = 200;
            this._responseURL = this._url;
            this._responseText = '{"data":{"d":""},"message":"success"}';
            this._response = this._responseText;
            try { this.onreadystatechange && this.onreadystatechange(); } catch (_) {}
            try { this.onload && this.onload(); } catch (_) {}
        }, 'send', 1),
    };
    XMLHttpRequest.prototype.constructor = XMLHttpRequest;
    return XMLHttpRequest;
}

function buildFetch() {
    return safefunction(function fetch(input) {
        const url = typeof input === 'string' ? input : (input && input.url);
        return Promise.resolve({
            ok: true, status: 200, url, redirected: false, type: 'basic',
            headers: {
                get: safefunction(function () { return null; }, 'get', 1),
                has: safefunction(function () { return false; }, 'has', 1),
                forEach: safefunction(function () {}, 'forEach', 1),
            },
            text: safefunction(function text() { return Promise.resolve('{"message":"success"}'); }, 'text', 0),
            json: safefunction(function json() { return Promise.resolve({ message: 'success' }); }, 'json', 0),
            arrayBuffer: safefunction(function arrayBuffer() { return Promise.resolve(new ArrayBuffer(0)); }, 'arrayBuffer', 0),
            blob: safefunction(function blob() { return Promise.resolve({}); }, 'blob', 0),
            clone: safefunction(function clone() { return this; }, 'clone', 0),
        });
    }, 'fetch', 1);
}

// ══════════════════════════════════════════════════════════════════════════════
// Main builder — same signature as core/fake_env.js
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Build a complete fake browser window.
 *
 * Compatible drop-in replacement for core/fake_env.js.
 *
 * @param {Object} [opts]
 * @param {string} [opts.userAgent]         User-Agent header
 * @param {string} [opts.href]              Page URL (used for location, referrer)
 * @param {number} [opts.canvasSeed=0]      Seed for canvas/webgl/audio fingerprints
 * @param {Function} [opts.beforeParse]     Lifecycle hook: called with (window) before freeze
 * @param {boolean} [opts.debugAll=false]   Enable document.all access monitoring
 * @returns {Object} window object suitable for vm.createContext()
 */
function buildFakeBrowser(opts = {}) {
    const UA = opts.userAgent ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';
    const href = opts.href || 'https://www.example.com/';
    const fpSeed = opts.canvasSeed || 0;

    // ── Window core ─────────────────────────────────────────────────────────
    const win = createWindow();

    // ── Navigator (full prototype engine) ───────────────────────────────────
    const nav = buildNavigator({ userAgent: UA });
    pb.defineReadOnly(nav, 'userAgent', UA);
    pb.defineReadOnly(nav, 'appVersion', UA.replace(/^Mozilla\//, ''));
    win.navigator = nav;

    // ── Standard BOM ────────────────────────────────────────────────────────
    win.screen = buildScreen();
    win.location = buildLocation(href);
    win.history = buildHistory();
    win.document = buildDocument(href, { canvasSeed: fpSeed, debugAll: opts.debugAll });
    win.document.location = win.location;

    // ── Storage ─────────────────────────────────────────────────────────────
    const storage = buildStorage();
    win.localStorage = storage.local;
    win.sessionStorage = storage.session;

    // ── Performance ─────────────────────────────────────────────────────────
    win.performance = buildPerformance();

    // ── Crypto ──────────────────────────────────────────────────────────────
    win.crypto = buildCrypto();

    // ── Web platform classes ────────────────────────────────────────────────
    win.XMLHttpRequest = buildXMLHttpRequest();
    win.fetch = buildFetch();

    win.Headers = class Headers {
        constructor(init) { this._h = {}; if (init) for (const [k, v] of Object.entries(init)) this._h[k.toLowerCase()] = v; }
        get(k) { return this._h[k.toLowerCase()] || null; }
        set(k, v) { this._h[k.toLowerCase()] = v; }
        has(k) { return k.toLowerCase() in this._h; }
    };
    safefunction(win.Headers, 'Headers', 0);

    win.Request = class Request { constructor(u, i) { this.url = String(u); this.method = (i && i.method) || 'GET'; } };
    safefunction(win.Request, 'Request', 1);

    win.Response = class Response {
        constructor(b, i) { this.body = b; this.status = (i && i.status) || 200; this.ok = this.status < 400; }
    };
    safefunction(win.Response, 'Response', 1);

    win.FormData = class FormData { append() {} get() {} };
    safefunction(win.FormData, 'FormData', 0);

    win.Blob = class Blob { constructor(p, o) { this.size = (p || []).reduce((n, x) => n + ((x && x.length) || 0), 0); this.type = (o && o.type) || ''; } };
    safefunction(win.Blob, 'Blob', 1);

    win.URL = require('url').URL;
    win.URLSearchParams = require('url').URLSearchParams;

    win.AbortController = class AbortController {
        constructor() { this.signal = { aborted: false, addEventListener() {} }; }
        abort() { this.signal.aborted = true; }
    };
    safefunction(win.AbortController, 'AbortController', 0);

    // ── Observers ───────────────────────────────────────────────────────────
    win.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
    safefunction(win.IntersectionObserver, 'IntersectionObserver', 1);
    win.MutationObserver = class { observe() {} disconnect() {} };
    safefunction(win.MutationObserver, 'MutationObserver', 1);
    win.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    safefunction(win.ResizeObserver, 'ResizeObserver', 1);

    // ── AudioContext (fingerprint engine) ───────────────────────────────────
    win.AudioContext = class AudioContext {
        constructor() { return createAudioContext(fpSeed); }
    };
    safefunction(win.AudioContext, 'AudioContext', 0);
    win.webkitAudioContext = win.AudioContext;
    win.OfflineAudioContext = class OfflineAudioContext {
        constructor(c, l, sr) { return createAudioContext(fpSeed, { sampleRate: sr }); }
    };
    safefunction(win.OfflineAudioContext, 'OfflineAudioContext', 3);

    // ── Timers ──────────────────────────────────────────────────────────────
    win.setTimeout = setTimeout;
    win.clearTimeout = clearTimeout;
    win.setInterval = setInterval;
    win.clearInterval = clearInterval;
    win.queueMicrotask = queueMicrotask;
    win.requestAnimationFrame = safefunction(function requestAnimationFrame(cb) {
        return setTimeout(() => cb(Date.now()), 16);
    }, 'requestAnimationFrame', 1);
    win.cancelAnimationFrame = clearTimeout;

    // ── Encoding ────────────────────────────────────────────────────────────
    win.atob = safefunction(function atob(s) { return Buffer.from(s, 'base64').toString('binary'); }, 'atob', 1);
    win.btoa = safefunction(function btoa(s) { return Buffer.from(s, 'binary').toString('base64'); }, 'btoa', 1);

    // ── Standard globals ────────────────────────────────────────────────────
    win.Math = Math;
    win.Date = Date;
    win.JSON = JSON;
    win.Promise = Promise;
    win.Symbol = Symbol;
    win.Array = Array;
    win.Object = Object;
    win.Reflect = Reflect;
    win.Proxy = Proxy;
    win.Map = Map;
    win.Set = Set;
    win.WeakMap = WeakMap;
    win.WeakSet = WeakSet;
    win.Error = Error;
    win.TypeError = TypeError;
    win.RangeError = RangeError;
    win.SyntaxError = SyntaxError;
    win.Function = Function;
    win.RegExp = RegExp;
    win.parseInt = parseInt;
    win.parseFloat = parseFloat;
    win.isNaN = isNaN;
    win.isFinite = isFinite;
    win.encodeURIComponent = encodeURIComponent;
    win.decodeURIComponent = decodeURIComponent;
    win.encodeURI = encodeURI;
    win.decodeURI = decodeURI;
    win.Int8Array = Int8Array;
    win.Uint8Array = Uint8Array;
    win.Uint8ClampedArray = Uint8ClampedArray;
    win.Int16Array = Int16Array;
    win.Uint16Array = Uint16Array;
    win.Int32Array = Int32Array;
    win.Uint32Array = Uint32Array;
    win.Float32Array = Float32Array;
    win.Float64Array = Float64Array;
    win.ArrayBuffer = ArrayBuffer;
    win.DataView = DataView;

    // ── Window events ──────────────────────────────────────────────────────
    win.addEventListener = safefunction(function () {}, 'addEventListener', 3);
    win.removeEventListener = safefunction(function () {}, 'removeEventListener', 3);
    win.dispatchEvent = safefunction(function () { return true; }, 'dispatchEvent', 1);

    // ── Anti-rehost ─────────────────────────────────────────────────────────
    win.process = undefined;
    win.Deno = undefined;
    win.require = undefined;
    win.global = undefined;
    win.module = undefined;
    win.__dirname = undefined;
    win.__filename = undefined;

    // ── Console ─────────────────────────────────────────────────────────────
    win.console = opts.console || console;

    // ── beforeParse lifecycle hook ─────────────────────────────────────────
    // Allows injection of site-specific state (cookies, $_ts, runtime tokens)
    // before freezing / vm.createContext.
    if (typeof opts.beforeParse === 'function') {
        opts.beforeParse(win);
    }

    return win;
}

module.exports = { buildFakeBrowser };
