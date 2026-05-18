// src/env/core.js
// Browser prototype-chain framework.
//
// Defines constructors + prototype chains for:
//   EventTarget → WindowProperties → Window
//   Navigator
//   PluginArray
//   Plugin
//
// Every constructor throws TypeError("Illegal constructor") when called
// directly, matching browser WebIDL behavior.  instanceof works correctly
// because instances have the right [[Prototype]].
//
// Each prototype carries a Symbol.toStringTag matching its constructor name,
// so Object.prototype.toString.call(navigator) returns "[object Navigator]".

'use strict';

const { safefunction } = require('./utils');
const { PrototypeBuilder } = require('./prototype');

const pb = new PrototypeBuilder({ debug: true });

// ══════════════════════════════════════════════════════════════════════════════
// 1. EventTarget (base)
// ══════════════════════════════════════════════════════════════════════════════

function EventTarget() {
    throw new TypeError('Illegal constructor');
}
safefunction(EventTarget, 'EventTarget', 0);
pb.defineReadOnly(EventTarget.prototype, Symbol.toStringTag, 'EventTarget');

// ══════════════════════════════════════════════════════════════════════════════
// 2. WindowProperties → EventTarget
// ══════════════════════════════════════════════════════════════════════════════

function WindowProperties() {
    throw new TypeError('Illegal constructor');
}
safefunction(WindowProperties, 'WindowProperties', 0);
pb.setPrototype(WindowProperties.prototype, EventTarget.prototype);
pb.defineReadOnly(WindowProperties.prototype, Symbol.toStringTag, 'WindowProperties');

// ══════════════════════════════════════════════════════════════════════════════
// 3. Window → WindowProperties
// ══════════════════════════════════════════════════════════════════════════════

function Window() {
    throw new TypeError('Illegal constructor');
}
safefunction(Window, 'Window', 0);
pb.setPrototype(Window.prototype, WindowProperties.prototype);
pb.defineReadOnly(Window.prototype, Symbol.toStringTag, 'Window');

// ══════════════════════════════════════════════════════════════════════════════
// 4. Navigator
// ══════════════════════════════════════════════════════════════════════════════

function Navigator() {
    throw new TypeError('Illegal constructor');
}
safefunction(Navigator, 'Navigator', 0);
pb.defineReadOnly(Navigator.prototype, Symbol.toStringTag, 'Navigator');

// ══════════════════════════════════════════════════════════════════════════════
// 5. PluginArray
// ══════════════════════════════════════════════════════════════════════════════

function PluginArray() {
    throw new TypeError('Illegal constructor');
}
safefunction(PluginArray, 'PluginArray', 0);
pb.defineReadOnly(PluginArray.prototype, Symbol.toStringTag, 'PluginArray');

// ══════════════════════════════════════════════════════════════════════════════
// 6. Plugin
// ══════════════════════════════════════════════════════════════════════════════

function Plugin() {
    throw new TypeError('Illegal constructor');
}
safefunction(Plugin, 'Plugin', 0);
pb.defineReadOnly(Plugin.prototype, Symbol.toStringTag, 'Plugin');

// ══════════════════════════════════════════════════════════════════════════════
// 7. MimeType
// ══════════════════════════════════════════════════════════════════════════════

function MimeType() {
    throw new TypeError('Illegal constructor');
}
safefunction(MimeType, 'MimeType', 0);
pb.defineReadOnly(MimeType.prototype, Symbol.toStringTag, 'MimeType');

// ══════════════════════════════════════════════════════════════════════════════
// 8. MimeTypeArray
// ══════════════════════════════════════════════════════════════════════════════

function MimeTypeArray() {
    throw new TypeError('Illegal constructor');
}
safefunction(MimeTypeArray, 'MimeTypeArray', 0);
pb.defineReadOnly(MimeTypeArray.prototype, Symbol.toStringTag, 'MimeTypeArray');

// ══════════════════════════════════════════════════════════════════════════════
// Prototype locking
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Lock all prototype objects to prevent SDK tampering.
 *
 * After calling this, SDK code cannot redefine, delete, or override
 * prototype properties via Object.defineProperty.  Call this AFTER
 * all prototype methods and accessors have been defined.
 */
function lockPrototypes() {
    const protos = [
        EventTarget.prototype,
        WindowProperties.prototype,
        Window.prototype,
        Navigator.prototype,
        PluginArray.prototype,
        Plugin.prototype,
        MimeType.prototype,
        MimeTypeArray.prototype,
    ];
    for (const p of protos) {
        pb.lockAll(p);
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// Instance factories
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Create a bare Window instance.
 *
 * window.window / .self / .globalThis / .top / .parent / .frames all point
 * back to the instance itself (circular).  Caller should add navigator,
 * document, screen, etc. after creation.
 *
 * @returns {Object} window instance with [[Prototype]] = Window.prototype
 */
function createWindow() {
    const win = {};
    pb.setPrototype(win, Window.prototype);

    // Circular self-references match browser behavior
    win.window = win;
    win.self = win;
    win.globalThis = win;
    win.top = win;
    win.parent = win;
    win.frames = win;

    return win;
}

/**
 * Create a bare Navigator instance.
 *
 * Caller should populate userAgent, platform, plugins, etc. after creation.
 *
 * @returns {Object} navigator instance with [[Prototype]] = Navigator.prototype
 */
function createNavigator() {
    const nav = {};
    pb.setPrototype(nav, Navigator.prototype);
    return nav;
}

/**
 * Create a bare PluginArray instance.
 *
 * @returns {Object} PluginArray instance
 */
function createPluginArray() {
    const arr = {};
    pb.setPrototype(arr, PluginArray.prototype);
    // length is a dynamic getter on PluginArray.prototype (set by navigator.js)
    return arr;
}

/**
 * Create a bare Plugin instance.
 *
 * @param {string} name
 * @param {string} filename
 * @param {string} [description]
 * @returns {Object} Plugin instance
 */
function createPlugin(name, filename, description) {
    const p = {};
    pb.setPrototype(p, Plugin.prototype);
    pb.defineReadOnly(p, 'name', name || '');
    pb.defineReadOnly(p, 'filename', filename || '');
    pb.defineReadOnly(p, 'description', description || '');
    // length is a dynamic getter on Plugin.prototype (set by navigator.js)
    return p;
}

/**
 * Create a bare MimeType instance.
 *
 * @param {string} type
 * @param {string} description
 * @param {string} suffixes
 * @param {Object} enabledPlugin  back-reference to parent Plugin
 * @returns {Object} MimeType instance
 */
function createMimeType(type, description, suffixes, enabledPlugin) {
    const mt = {};
    pb.setPrototype(mt, MimeType.prototype);
    pb.defineReadOnly(mt, 'type', type || '');
    pb.defineReadOnly(mt, 'description', description || '');
    pb.defineReadOnly(mt, 'suffixes', suffixes || '');
    pb.defineReadOnly(mt, 'enabledPlugin', enabledPlugin || null);
    return mt;
}

/**
 * Create a bare MimeTypeArray instance.
 *
 * @returns {Object} MimeTypeArray instance
 */
function createMimeTypeArray() {
    const arr = {};
    pb.setPrototype(arr, MimeTypeArray.prototype);
    // length is a dynamic getter on MimeTypeArray.prototype (set by navigator.js)
    return arr;
}

// ══════════════════════════════════════════════════════════════════════════════
// Exports
// ══════════════════════════════════════════════════════════════════════════════

module.exports = {
    // Constructors
    EventTarget,
    WindowProperties,
    Window,
    Navigator,
    PluginArray,
    Plugin,
    MimeType,
    MimeTypeArray,
    // Factories
    createWindow,
    createNavigator,
    createPluginArray,
    createPlugin,
    createMimeType,
    createMimeTypeArray,
    // Locking
    lockPrototypes,
};
