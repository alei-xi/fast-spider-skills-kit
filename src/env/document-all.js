// src/env/document-all.js
// Best-effort document.all simulation without C++ addon.
//
// Pure JavaScript CANNOT fake `typeof` (it's a V8-internal operator).
// The C++ MarkAsUndetectable() flag is required for perfect simulation.
// This module provides the best possible JS-only compromise + access monitoring.
//
// What we CAN simulate:
//   document.all == undefined       → NOT achievable in pure JS
//     (abstract equality against undefined never calls ToPrimitive;
//      only V8 MarkAsUndetectable() C++ flag works)
//   document.all === undefined      → false (it IS an object)
//   document.all('id')              → null  (callable)
//   document.all.length             → N     (property access)
//   'id' in document.all            → true  (has trap)
//   Object.prototype.toString.call  → [object HTMLAllCollection]
//
// What we CANNOT simulate without C++:
//   typeof document.all             → always 'function' (Proxy target is fn)
//   !document.all                   → always false (objects are truthy)
//
// Monitoring: when opts.monitor=true, all accesses are logged to an internal
// array for debugging.  Use .getAccessLog() to retrieve and .clearAccessLog()
// to reset.

'use strict';

const { safefunction } = require('./utils');

// ── HTMLAllCollection constructor ───────────────────────────────────────────

function HTMLAllCollection() {
    throw new TypeError('Illegal constructor');
}
safefunction(HTMLAllCollection, 'HTMLAllCollection', 0);

// ── Builder ─────────────────────────────────────────────────────────────────

/**
 * Create a document.all simulation.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.monitor=false]  Enable access monitoring
 * @param {number} [opts.length=0]        Initial length
 * @param {Object} [opts.elements={}]     Pre-populated element map
 * @returns {Object} document.all simulation with instanceof HTMLAllCollection
 */
function createDocumentAll(opts = {}) {
    const monitor = opts.monitor || false;
    const _elements = opts.elements || {};
    const _accessLog = monitor ? [] : null;

    function _record(prop) {
        if (!monitor) return;
        const err = new Error();
        const stack = err.stack ? err.stack.split('\n').slice(2, 6).join('\n') : '';
        _accessLog.push({ prop, time: Date.now(), stack });
    }

    // The proxy target is a function — makes document.all callable
    const target = function all() {
        _record('.call()');
        if (arguments.length === 0) return null;
        const key = String(arguments[0]);
        // Support both numeric index (as string) and element name/id
        const el = _elements[key];
        return el !== undefined ? el : null;
    };

    const handler = {
        get(_, prop, receiver) {
            if (typeof prop === 'symbol') {
                if (prop === Symbol.toPrimitive) {
                    return function (hint) {
                        _record('Symbol.toPrimitive');
                        return hint === 'number' ? 0 : undefined;
                    };
                }
                if (prop === Symbol.toStringTag) return 'HTMLAllCollection';
                if (prop === Symbol.iterator) {
                    return function* () {
                        for (const key of Object.keys(_elements)) yield _elements[key];
                    };
                }
                return undefined;
            }

            const key = String(prop);

            // Internal API: return without recording (prevents false positives in logs)
            if (key === 'getAccessLog') {
                return function () { return target._getAccessLog(); };
            }
            if (key === 'clearAccessLog') {
                return function () { return target._clearAccessLog(); };
            }
            if (key === '_register') return target._register;
            if (key === '_deregister') return target._deregister;

            // Only record external access
            _record(key);

            // Named element access: document.all['elementId']
            if (key in _elements) return _elements[key];

            // Property lookups
            if (key === 'length') return Object.keys(_elements).length;

            // Standard HTMLAllCollection methods
            if (key === 'item') {
                return safefunction(function item(index) {
                    const keys = Object.keys(_elements);
                    return index < keys.length ? _elements[keys[index]] : null;
                }, 'item', 1);
            }
            if (key === 'namedItem') {
                return safefunction(function namedItem(name) {
                    return _elements[name] || null;
                }, 'namedItem', 1);
            }

            return undefined;
        },

        has(_, prop) {
            if (typeof prop === 'symbol') {
                return prop === Symbol.toStringTag || prop === Symbol.iterator;
            }
            // 'in' operator: SDKs check for element IDs
            return prop in _elements || prop === 'length' || prop === 'item' || prop === 'namedItem';
        },

        ownKeys(_) {
            const keys = Object.keys(_elements);
            keys.push('length', 'item', 'namedItem');
            return keys;
        },

        getOwnPropertyDescriptor(_, prop) {
            if (typeof prop === 'symbol') return undefined;
            if (prop in _elements) {
                return {
                    value: _elements[prop],
                    enumerable: true,
                    configurable: true,
                    writable: false,
                };
            }
            if (prop === 'length') {
                return {
                    value: Object.keys(_elements).length,
                    enumerable: false,
                    configurable: false,
                    writable: false,
                };
            }
            return undefined;
        },
    };

    const all = new Proxy(target, handler);
    Object.setPrototypeOf(all, HTMLAllCollection.prototype);

    // Attach methods directly on target (handler passes through known method names)
    target._getAccessLog = function () { return _accessLog ? _accessLog.slice() : []; };
    target._clearAccessLog = function () { if (_accessLog) _accessLog.length = 0; };
    target._register = function (id, el) { _elements[id] = el; };
    target._deregister = function (id) { delete _elements[id]; };

    return all;
}

module.exports = { createDocumentAll, HTMLAllCollection };
