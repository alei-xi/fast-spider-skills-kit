// src/env/navigator.js
// Full Navigator environment assembler using the prototype engine.
//
// Produces a navigator instance that matches Chrome's fingerprint:
//   - 5 standard PDF plugins (Chrome PDF Plugin, Chrome PDF Viewer,
//     Microsoft Edge PDF Viewer, WebP/PDF built-in)
//   - Each plugin has 1-2 MimeTypes with back-references
//   - PluginArray + MimeTypeArray support for-of iteration, item(), namedItem()
//   - navigator.plugins and navigator.mimeTypes as getters on Navigator.prototype
//
// Usage:
//   const { buildNavigator } = require('./navigator');
//   const nav = buildNavigator({ userAgent: 'Mozilla/5.0 ...' });
//   // nav.plugins → PluginArray with 5 real Plugins
//   // nav.plugins[0] instanceof Plugin → true

'use strict';

const { safefunction } = require('./utils');
const { PrototypeBuilder } = require('./prototype');
const {
    Navigator, PluginArray, Plugin, MimeType, MimeTypeArray,
    createNavigator, createPluginArray, createPlugin, createMimeType, createMimeTypeArray,
} = require('./core');

const pb = new PrototypeBuilder({ debug: true });

// ══════════════════════════════════════════════════════════════════════════════
// PluginArray.prototype methods
// ══════════════════════════════════════════════════════════════════════════════

// Dynamic length based on _entries
pb.defineGetter(PluginArray.prototype, 'length', function () {
    return (this._entries || []).length;
});

function pluginArrayItem(index) {
    // 'this' is the PluginArray instance; _entries must be set by the builder
    const arr = this._entries || [];
    return arr[index] || null;
}
safefunction(pluginArrayItem, 'item', 1);
pb.defineReadOnly(PluginArray.prototype, 'item', pluginArrayItem);

function pluginArrayNamedItem(name) {
    const arr = this._entries || [];
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].name === name) return arr[i];
    }
    return null;
}
safefunction(pluginArrayNamedItem, 'namedItem', 1);
pb.defineReadOnly(PluginArray.prototype, 'namedItem', pluginArrayNamedItem);

function pluginArrayRefresh() { /* no-op — refresh(true) reloads plugins in real browser but we are static */ }
safefunction(pluginArrayRefresh, 'refresh', 0);
pb.defineReadOnly(PluginArray.prototype, 'refresh', pluginArrayRefresh);

// Symbol.iterator — enables for-of iteration
pb.defineReadOnly(PluginArray.prototype, Symbol.iterator, function () {
    const arr = this._entries || [];
    let i = 0;
    return {
        next() {
            return i < arr.length ? { value: arr[i++], done: false } : { done: true };
        },
    };
});

// ══════════════════════════════════════════════════════════════════════════════
// MimeTypeArray.prototype methods
// ══════════════════════════════════════════════════════════════════════════════

pb.defineGetter(MimeTypeArray.prototype, 'length', function () {
    return (this._entries || []).length;
});

function mimeTypeArrayItem(index) {
    const arr = this._entries || [];
    return arr[index] || null;
}
safefunction(mimeTypeArrayItem, 'item', 1);
pb.defineReadOnly(MimeTypeArray.prototype, 'item', mimeTypeArrayItem);

function mimeTypeArrayNamedItem(name) {
    const arr = this._entries || [];
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].type === name) return arr[i];
    }
    return null;
}
safefunction(mimeTypeArrayNamedItem, 'namedItem', 1);
pb.defineReadOnly(MimeTypeArray.prototype, 'namedItem', mimeTypeArrayNamedItem);

pb.defineReadOnly(MimeTypeArray.prototype, Symbol.iterator, function () {
    const arr = this._entries || [];
    let i = 0;
    return {
        next() {
            return i < arr.length ? { value: arr[i++], done: false } : { done: true };
        },
    };
});

// ══════════════════════════════════════════════════════════════════════════════
// Plugin.prototype — item / namedItem delegates to mimeTypes
// ══════════════════════════════════════════════════════════════════════════════

pb.defineGetter(Plugin.prototype, 'length', function () {
    const mt = this.mimeTypes;
    return mt ? mt.length : 0;
});

function pluginItem(index) {
    const mt = this.mimeTypes;
    if (!mt) return null;
    return mt.item(index);
}
safefunction(pluginItem, 'item', 1);
pb.defineReadOnly(Plugin.prototype, 'item', pluginItem);

function pluginNamedItem(name) {
    const mt = this.mimeTypes;
    if (!mt) return null;
    return mt.namedItem(name);
}
safefunction(pluginNamedItem, 'namedItem', 1);
pb.defineReadOnly(Plugin.prototype, 'namedItem', pluginNamedItem);

// ══════════════════════════════════════════════════════════════════════════════
// Plugin data — Chrome-standard PDF plugins
// ══════════════════════════════════════════════════════════════════════════════

const PLUGIN_DEFS = [
    {
        name: 'Chrome PDF Plugin',
        filename: 'internal-pdf-viewer',
        description: 'Portable Document Format',
        mimeTypes: [
            { type: 'application/pdf', description: 'Portable Document Format', suffixes: 'pdf' },
        ],
    },
    {
        name: 'Chrome PDF Viewer',
        filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
        description: '',
        mimeTypes: [
            { type: 'application/pdf', description: 'Portable Document Format', suffixes: 'pdf' },
        ],
    },
    {
        name: 'Microsoft Edge PDF Viewer',
        filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
        description: '',
        mimeTypes: [
            { type: 'application/pdf', description: 'Portable Document Format', suffixes: 'pdf' },
        ],
    },
    {
        name: 'WebP',
        filename: 'internal-webp-viewer',
        description: 'WebP Image',
        mimeTypes: [
            { type: 'image/webp', description: 'WebP Image', suffixes: 'webp' },
        ],
    },
    {
        name: 'PDF Viewer',
        filename: 'internal-pdf-viewer',
        description: 'Portable Document Format',
        mimeTypes: [
            { type: 'application/pdf', description: 'Portable Document Format', suffixes: 'pdf' },
            { type: 'text/pdf', description: 'Portable Document Format (Text)', suffixes: 'pdf' },
        ],
    },
];

// ══════════════════════════════════════════════════════════════════════════════
// Navigator.prototype getters
// ══════════════════════════════════════════════════════════════════════════════

// Storage for getter return values — populated by buildNavigator
const navState = new WeakMap();

function navPluginsGetter() { return navState.get(this).plugins; }
safefunction(navPluginsGetter, 'get plugins', 0);

function navMimeTypesGetter() { return navState.get(this).mimeTypes; }
safefunction(navMimeTypesGetter, 'get mimeTypes', 0);

pb.defineGetter(Navigator.prototype, 'plugins', navPluginsGetter);
pb.defineGetter(Navigator.prototype, 'mimeTypes', navMimeTypesGetter);

// ══════════════════════════════════════════════════════════════════════════════
// Builder
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Build a fully-populated Navigator instance with Chrome-standard plugins.
 *
 * @param {Object} [opts]
 * @param {string} [opts.userAgent]  User-Agent string
 * @returns {Object} navigator instance with plugins, mimeTypes, and properties
 */
function buildNavigator(opts = {}) {
    const nav = createNavigator();

    // ── Build plugins & mimeTypes ──────────────────────────────────────────
    const allPlugins = [];
    const allMimeTypes = [];

    for (const pdef of PLUGIN_DEFS) {
        const plugin = createPlugin(pdef.name, pdef.filename, pdef.description);

        // Build mimeTypes for this plugin
        const mimeTypeArr = createMimeTypeArray();
        const mimeTypeEntries = [];
        for (const mtdef of pdef.mimeTypes) {
            const mt = createMimeType(mtdef.type, mtdef.description, mtdef.suffixes, plugin);
            mimeTypeEntries.push(mt);
            allMimeTypes.push(mt);
        }

        // Patch entries onto mimeType array (length is dynamic via prototype getter)
        mimeTypeArr._entries = mimeTypeEntries;

        // Back-reference
        pb.defineReadOnly(plugin, 'mimeTypes', mimeTypeArr);

        allPlugins.push(plugin);
    }

    // ── Wire PluginArray (length is dynamic via prototype getter) ──────────
    const pluginArr = createPluginArray();
    pluginArr._entries = allPlugins;

    // ── Wire MimeTypeArray (length is dynamic via prototype getter) ────────
    const mimeTypeArr = createMimeTypeArray();
    mimeTypeArr._entries = allMimeTypes;

    // ── Store in state ─────────────────────────────────────────────────────
    navState.set(nav, { plugins: pluginArr, mimeTypes: mimeTypeArr });

    // ── Navigator basic properties ─────────────────────────────────────────
    const ua = opts.userAgent ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

    pb.defineReadOnly(nav, 'userAgent', ua);
    pb.defineReadOnly(nav, 'appName', 'Netscape');
    pb.defineReadOnly(nav, 'appCodeName', 'Mozilla');
    pb.defineReadOnly(nav, 'appVersion', ua.replace(/^Mozilla\//, ''));
    pb.defineReadOnly(nav, 'platform', 'Win32');
    pb.defineReadOnly(nav, 'vendor', 'Google Inc.');
    pb.defineReadOnly(nav, 'vendorSub', '');
    pb.defineReadOnly(nav, 'product', 'Gecko');
    pb.defineReadOnly(nav, 'productSub', '20030107');
    pb.defineReadOnly(nav, 'language', 'zh-CN');
    pb.defineReadOnly(nav, 'languages', ['zh-CN', 'zh', 'en']);
    pb.defineReadOnly(nav, 'cookieEnabled', true);
    pb.defineReadOnly(nav, 'hardwareConcurrency', 8);
    pb.defineReadOnly(nav, 'deviceMemory', 8);
    pb.defineReadOnly(nav, 'maxTouchPoints', 0);

    return nav;
}

module.exports = { buildNavigator };
