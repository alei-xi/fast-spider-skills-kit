// src/env/utils.js
// Foundation utilities for browser-environment simulation.
//
// Provides:
//   safefunction(fn, name, length)  — mark a function as "native" so its
//                                      toString() returns [native code]
//
// The Symbol-based marking approach avoids detectable property checks on
// the function itself — the Symbol key is invisible to for-in /
// Object.keys / getOwnPropertyNames enumeration.

'use strict';

// ── Internal state ──────────────────────────────────────────────────────────

const NATIVE_SYM = Symbol('safefunction:native');
const _origToString = Function.prototype.toString;

let _installed = false;

// ── One-time Function.prototype.toString hijack ─────────────────────────────

function _install() {
    if (_installed) return;
    _installed = true;

    // Build the replacement BEFORE deleting the original — Node may freeze
    // Function.prototype in some contexts.
    const replacement = function toString() {
        // eslint-disable-next-line no-invalid-this
        return this[NATIVE_SYM]
            ? `function ${this.name}() { [native code] }`
            : _origToString.call(this);
    };

    // Mark the replacement itself as native.
    replacement[NATIVE_SYM] = true;

    delete Function.prototype['toString'];

    Object.defineProperty(Function.prototype, 'toString', {
        value: replacement,
        enumerable: false,
        configurable: true,
        writable: true,
    });
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Mark a function as "native".
 *
 * After calling `safefunction(fn, 'myFunc', 2)`:
 *   - fn.toString() returns `function myFunc() { [native code] }`
 *   - fn.name === 'myFunc'  (non-enumerable, non-configurable, non-writable)
 *   - fn.length === 2       (non-enumerable, non-configurable, non-writable)
 *
 * @param {Function} fn      Target function
 * @param {string}  [name]   Desired .name value (skip to keep original)
 * @param {number}  [length] Desired .length value (skip to keep original)
 * @returns {Function} fn (chainable)
 */
function safefunction(fn, name, length) {
    // Ensure the global hijack is in place (idempotent).
    _install();

    // Mark as native.
    Object.defineProperty(fn, NATIVE_SYM, {
        value: true,
        enumerable: false,
        configurable: false,
        writable: false,
    });

    // Lock .name
    if (name !== undefined) {
        Object.defineProperty(fn, 'name', {
            value: String(name),
            enumerable: false,
            configurable: false,
            writable: false,
        });
    }

    // Lock .length
    if (length !== undefined) {
        Object.defineProperty(fn, 'length', {
            value: Number(length),
            enumerable: false,
            configurable: false,
            writable: false,
        });
    }

    return fn;
}

module.exports = { safefunction };
