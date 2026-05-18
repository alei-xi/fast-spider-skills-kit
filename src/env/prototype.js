// src/env/prototype.js
// PrototypeBuilder — factory for browser-spec prototype objects.
//
// Usage:
//   const pb = new PrototypeBuilder({ debug: true });
//   pb.defineReadOnly(navProto, 'userAgent', '...');
//   pb.setPrototype(navigator, navProto);
//
// Logging:
//   PrototypeBuilder.Log = { debug: (msg, ...args) => myLogger.debug(msg, args) };
//   Set to null to suppress all output.  Defaults to null (silent).

'use strict';

// ── Logger ──────────────────────────────────────────────────────────────────

// Public static property — assign your own logger object.
// Expected shape: { debug(msg: string, ...args): void }
PrototypeBuilder.Log = null;

const noop = () => {};
const LOG = new Proxy({}, {
    get(_, method) {
        const logger = PrototypeBuilder.Log;
        if (!logger) return noop;
        const fn = logger[method];
        return typeof fn === 'function' ? fn.bind(logger) : noop;
    },
});

// ── Constructor ─────────────────────────────────────────────────────────────

/**
 * @param {Object} opts
 * @param {boolean} [opts.debug=true]   Enable debug logging via PrototypeBuilder.Log
 */
function PrototypeBuilder(opts = {}) {
    this._debug = opts.debug !== false;
}

PrototypeBuilder.prototype._log = function (method, ...args) {
    if (this._debug) LOG[method](...args);
};

// ── defineReadOnly ──────────────────────────────────────────────────────────

/**
 * Define a read-only data property on target.
 *
 * Descriptor matching browser built-in API conventions:
 *   enumerable:   false   (most built-in APIs are non-enumerable)
 *   configurable: false   (cannot be deleted or redefined)
 *   writable:     false   (cannot be reassigned)
 *
 * @param {Object} target
 * @param {string} key
 * @param {*}      value
 * @param {Object} [opts]
 * @param {boolean} [opts.enumerable=false]
 * @param {boolean} [opts.configurable=false]
 */
PrototypeBuilder.prototype.defineReadOnly = function (target, key, value, opts) {
    const enumerable = (opts && 'enumerable' in opts) ? opts.enumerable : false;
    const configurable = (opts && 'configurable' in opts) ? opts.configurable : false;

    Object.defineProperty(target, key, {
        value,
        enumerable,
        configurable,
        writable: false,
    });

    this._log('debug', `[PrototypeBuilder] defineReadOnly: ${_describe(target)}.${_keyStr(key)} = ${_brief(value)}`);
};

// ── defineGetter ────────────────────────────────────────────────────────────

/**
 * Define a getter property on target.
 *
 * Descriptor matching browser built-in API conventions:
 *   enumerable:   false   (most built-in APIs are non-enumerable)
 *   configurable: false   (cannot be deleted or redefined)
 *
 * @param {Object}   target
 * @param {string}   key
 * @param {Function} getter
 * @param {Object}   [opts]
 * @param {boolean}  [opts.enumerable=false]
 * @param {boolean}  [opts.configurable=false]
 */
PrototypeBuilder.prototype.defineGetter = function (target, key, getter, opts) {
    const enumerable = (opts && 'enumerable' in opts) ? opts.enumerable : false;
    const configurable = (opts && 'configurable' in opts) ? opts.configurable : false;

    Object.defineProperty(target, key, {
        get: getter,
        enumerable,
        configurable,
    });

    this._log('debug', `[PrototypeBuilder] defineGetter: ${_describe(target)}.${_keyStr(key)}`);
};

// ── setPrototype ────────────────────────────────────────────────────────────

/**
 * Set the [[Prototype]] of target to proto.
 *
 * @param {Object} target
 * @param {Object} proto
 */
PrototypeBuilder.prototype.setPrototype = function (target, proto) {
    Object.setPrototypeOf(target, proto);
    this._log('debug', `[PrototypeBuilder] setPrototype: ${_describe(target)} → ${_describe(proto)}`);
};

// ── lockProperty ───────────────────────────────────────────────────────────

/**
 * Freeze an existing property: make it non-configurable and non-writable.
 *
 * Handles both data properties (value + writable) and accessor properties
 * (get + set).  Already-locked properties are quietly skipped (no throw).
 *
 * @param {Object} target
 * @param {string} key
 */
PrototypeBuilder.prototype.lockProperty = function (target, key) {
    const desc = Object.getOwnPropertyDescriptor(target, key);
    if (!desc) {
        this._log('warn', `[PrototypeBuilder] lockProperty: ${_describe(target)}.${_keyStr(key)} — not found, skipped`);
        return;
    }
    // Already non-configurable — nothing to do (re-defining would throw)
    if (desc.configurable === false) return;

    const patch = { configurable: false };
    // Accessor descriptors (get/set) do not have 'writable' — only lock data props
    if ('writable' in desc) {
        patch.writable = false;
    }

    Object.defineProperty(target, key, patch);
    this._log('debug', `[PrototypeBuilder] lockProperty: ${_describe(target)}.${_keyStr(key)} locked`);
};

// ── lockAll ─────────────────────────────────────────────────────────────────

/**
 * Lock every own property on target.
 *
 * This is the bulk equivalent of lockProperty, used to seal an entire
 * prototype after all its methods and accessors have been defined.
 *
 * @param {Object} target
 * @param {Object} [opts]
 * @param {boolean} [opts.skipConstructor=true]  Skip the 'constructor' property
 */
PrototypeBuilder.prototype.lockAll = function (target, opts) {
    const skipConstructor = !opts || opts.skipConstructor !== false;

    const keys = Object.getOwnPropertyNames(target);
    for (const key of keys) {
        if (skipConstructor && key === 'constructor') continue;
        this.lockProperty(target, key);
    }
    this._log('debug', `[PrototypeBuilder] lockAll: ${_describe(target)} — ${keys.length} keys processed`);
};

// ── Helpers (private) ───────────────────────────────────────────────────────

function _describe(obj) {
    if (obj === null) return 'null';
    if (obj === undefined) return 'undefined';
    if (obj.constructor && obj.constructor.name) return obj.constructor.name;
    if (obj.prototype && obj.prototype.constructor) return obj.prototype.constructor.name;
    return String(obj).slice(0, 40);
}

function _keyStr(key) {
    return typeof key === 'symbol' ? `[${key.toString()}]` : String(key);
}

function _brief(val) {
    switch (typeof val) {
    case 'function': return 'function';
    case 'object': return val === null ? 'null' : 'object';
    case 'undefined': return 'undefined';
    case 'symbol': return `[${val.toString()}]`;
    case 'string': return val.length > 40 ? `"${val.slice(0, 38)}..."` : `"${val}"`;
    default: return String(val);
    }
}

module.exports = { PrototypeBuilder };
