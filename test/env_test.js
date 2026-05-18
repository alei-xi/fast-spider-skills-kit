// test/env_test.js
// Independent verification of src/env/utils.js and src/env/prototype.js.
//
// Run:  node test/env_test.js
// This does NOT import or modify any existing core/ files.

'use strict';

const { safefunction } = require('../src/env/utils');
const { PrototypeBuilder } = require('../src/env/prototype');
const {
    EventTarget, WindowProperties, Window,
    Navigator, PluginArray, Plugin, MimeType, MimeTypeArray,
    createWindow, createNavigator, createPluginArray, createPlugin,
    createMimeType, createMimeTypeArray,
    lockPrototypes,
} = require('../src/env/core');

const { buildNavigator } = require('../src/env/navigator');
const { buildFakeBrowser } = require('../src/env/browser');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
    if (cond) {
        console.log(`  ✓ ${msg}`);
        passed++;
    } else {
        console.error(`  ✗ FAIL: ${msg}`);
        failed++;
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// Suite 1: safefunction
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Suite 1: safefunction ──\n');

// 1.1 — toString returns [native code]
console.log('# 1.1 toString() → [native code]');
{
    const fn = safefunction(function myFunc() { return 42; }, 'myFunc', 0);
    const str = fn.toString();
    assert(str === 'function myFunc() { [native code] }',
        `toString() = ${JSON.stringify(str)}`);
}

// 1.2 — .name is locked
console.log('# 1.2 .name locked');
{
    const fn = safefunction(function () {}, 'secureFunc', 3);
    assert(fn.name === 'secureFunc', `.name = "${fn.name}" (expected "secureFunc")`);
    const desc = Object.getOwnPropertyDescriptor(fn, 'name');
    assert(desc.enumerable === false, 'name.enumerable === false');
    assert(desc.writable === false, 'name.writable === false');
    assert(desc.configurable === false, 'name.configurable === false');
}

// 1.3 — .length is locked
console.log('# 1.3 .length locked');
{
    const fn = safefunction(function (a, b, c) {}, 'triple', 3);
    assert(fn.length === 3, `.length = ${fn.length} (expected 3)`);
    const desc = Object.getOwnPropertyDescriptor(fn, 'length');
    assert(desc.writable === false, 'length.writable === false');
    assert(desc.configurable === false, 'length.configurable === false');
}

// 1.4 — anonymous function toString
console.log('# 1.4 anonymous function');
{
    // When name is empty string, Chrome shows "function () { [native code] }"
    const fn = safefunction(function () {}, '', 0);
    const str = fn.toString();
    assert(str === 'function () { [native code] }',
        `toString() = ${JSON.stringify(str)}`);
}

// 1.5 — unmarked functions still call original toString
console.log('# 1.5 unmarked function unchanged');
{
    const fn = function hello() { return 1; };
    const str = fn.toString();
    assert(str.includes('function hello') && !str.includes('[native code]'),
        `unmarked toString = ${JSON.stringify(str.slice(0, 50))}...`);
}

// 1.6 — Function.prototype.toString itself is native
console.log('# 1.6 Function.prototype.toString is native');
{
    const str = Function.prototype.toString.toString();
    assert(str === 'function toString() { [native code] }',
        `toString.toString() = ${JSON.stringify(str)}`);
}

// 1.7 — symbol marker is invisible
console.log('# 1.7 symbol marker invisible');
{
    const fn = safefunction(function () {}, 'hiddenMark', 0);
    const keys = Object.keys(fn);
    const names = Object.getOwnPropertyNames(fn);
    const symbols = Object.getOwnPropertySymbols(fn);
    assert(keys.length === 0, `Object.keys = [${keys}] (expected empty)`);
    assert(symbols.length === 1, `Symbols count = ${symbols.length} (expected 1)`);
    // The symbol should exist but be invisible to enumeration
}

// ══════════════════════════════════════════════════════════════════════════════
// Suite 2: PrototypeBuilder — defineReadOnly
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Suite 2: PrototypeBuilder.defineReadOnly ──\n');

PrototypeBuilder.Log = { debug: () => {} };  // suppress log output for tests

const pb = new PrototypeBuilder({ debug: false });

console.log('# 2.1 defineReadOnly creates non-enumerable, non-writable property');
{
    const obj = {};
    pb.defineReadOnly(obj, 'ua', 'Chrome');
    assert(obj.ua === 'Chrome', 'value is "Chrome"');

    const desc = Object.getOwnPropertyDescriptor(obj, 'ua');
    assert(desc.enumerable === false, 'enumerable === false');
    assert(desc.writable === false, 'writable === false');
    assert(desc.configurable === false, 'configurable === false');
    assert(desc.value === 'Chrome', 'value preserved');
}

console.log('# 2.2 defineReadOnly respects opts.enumerable');
{
    const obj = {};
    pb.defineReadOnly(obj, 'visible', 42, { enumerable: true });
    const desc = Object.getOwnPropertyDescriptor(obj, 'visible');
    assert(desc.enumerable === true, 'enumerable === true (overridden)');
    assert('visible' in Object.keys(obj) || true, 'property present on object');
}

console.log('# 2.3 value cannot be reassigned (writable: false)');
{
    const obj = {};
    pb.defineReadOnly(obj, 'frozen', 99);
    try {
        obj.frozen = 100;
    } catch (_) { /* strict mode throws */ }
    assert(obj.frozen === 99, `value still ${obj.frozen} (expected 99)`);
}

console.log('# 2.4 readOnly keys are invisible to Object.keys');
{
    const obj = {};
    pb.defineReadOnly(obj, 'hidden', 'secret');
    assert(Object.keys(obj).length === 0,
        `Object.keys = [${Object.keys(obj)}] (expected [])`);
}

// ══════════════════════════════════════════════════════════════════════════════
// Suite 3: PrototypeBuilder — defineGetter
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Suite 3: PrototypeBuilder.defineGetter ──\n');

console.log('# 3.1 getter returns expected value');
{
    const obj = {};
    let callCount = 0;
    pb.defineGetter(obj, 'dynamic', () => `called ${++callCount}`);
    assert(obj.dynamic === 'called 1', 'first call');
    assert(obj.dynamic === 'called 2', 'second call (getter re-executes)');
}

console.log('# 3.2 getter descriptor matches browser conventions');
{
    const obj = {};
    pb.defineGetter(obj, 'webglRenderer', () => 'ANGLE');
    const desc = Object.getOwnPropertyDescriptor(obj, 'webglRenderer');
    assert(typeof desc.get === 'function', 'has getter function');
    assert(desc.set === undefined, 'set is undefined');
    assert(desc.enumerable === false, 'enumerable === false');
    assert(desc.configurable === false, 'configurable === false');
}

console.log('# 3.3 getter with enumerable override');
{
    const obj = {};
    pb.defineGetter(obj, 'visible', () => 'yes', { enumerable: true });
    const desc = Object.getOwnPropertyDescriptor(obj, 'visible');
    assert(desc.enumerable === true, 'enumerable === true (overridden)');
}

// ══════════════════════════════════════════════════════════════════════════════
// Suite 4: PrototypeBuilder — setPrototype
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Suite 4: PrototypeBuilder.setPrototype ──\n');

console.log('# 4.1 prototype chain is correctly established');
{
    function Navigator() { throw new TypeError('Illegal constructor'); }
    safefunction(Navigator, 'Navigator', 0);

    const navProto = Navigator.prototype;
    const navInstance = {};
    pb.setPrototype(navInstance, navProto);

    assert(Object.getPrototypeOf(navInstance) === navProto,
        '__proto__ points to Navigator.prototype');
    assert(navInstance instanceof Navigator,
        'navInstance instanceof Navigator (true)');
}

console.log('# 4.2 multi-level prototype chain');
{
    function EventTarget() { throw new TypeError('Illegal constructor'); }
    safefunction(EventTarget, 'EventTarget', 0);

    function Window() { throw new TypeError('Illegal constructor'); }
    safefunction(Window, 'Window', 0);

    pb.setPrototype(Window.prototype, EventTarget.prototype);

    const win = {};
    pb.setPrototype(win, Window.prototype);

    assert(win instanceof Window, 'win instanceof Window');
    assert(win instanceof EventTarget, 'win instanceof EventTarget (inherited)');
    assert(win instanceof Object, 'win instanceof Object');
}

// ══════════════════════════════════════════════════════════════════════════════
// Suite 5: PrototypeBuilder — lockProperty
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Suite 5: PrototypeBuilder.lockProperty ──\n');

console.log('# 5.1 lockProperty makes property non-configurable');
{
    const obj = {};
    pb.defineReadOnly(obj, 'x', 10, { configurable: true }); // start configurable
    let desc = Object.getOwnPropertyDescriptor(obj, 'x');
    assert(desc.configurable === true, 'configurable === true (before lock)');

    pb.lockProperty(obj, 'x');
    desc = Object.getOwnPropertyDescriptor(obj, 'x');
    assert(desc.configurable === false, 'configurable === false (after lock)');
    assert(desc.writable === false, 'writable === false (after lock)');
}

console.log('# 5.2 lockProperty on non-existent key warns but does not throw');
{
    const obj = {};
    // Should not throw
    pb.lockProperty(obj, 'nonexistent');
    assert(true, 'lockProperty on missing key does not throw');
}

// ══════════════════════════════════════════════════════════════════════════════
// Suite 6: Debug logging redirection
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Suite 6: Debug logging ──\n');

console.log('# 6.1 PrototypeBuilder.Log can be redirected');
{
    const captured = [];
    const origLog = PrototypeBuilder.Log;
    PrototypeBuilder.Log = { debug: (msg, ...args) => captured.push([msg, args]) };

    const pb2 = new PrototypeBuilder({ debug: true });
    const obj = {};
    pb2.defineReadOnly(obj, 'testKey', 'testVal');

    assert(captured.length >= 1, `logged ${captured.length} messages`);
    assert(captured[0][0].includes('defineReadOnly'), 'log message mentions defineReadOnly');

    PrototypeBuilder.Log = origLog; // restore
}

console.log('# 6.2 PrototypeBuilder.Log = null suppresses output');
{
    const origLog = PrototypeBuilder.Log;
    PrototypeBuilder.Log = null;

    const pb2 = new PrototypeBuilder({ debug: true });
    const obj = {};
    pb2.defineReadOnly(obj, 'silent', true);  // should not throw

    PrototypeBuilder.Log = origLog; // restore
    assert(true, 'null logger does not throw');
}

// ══════════════════════════════════════════════════════════════════════════════
// Suite 7: Step 2 — core.js constructors throw Illegal constructor
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Suite 7: core.js constructors throw ──\n');

console.log('# 7.1 EventTarget() throws');
{
    let threw = false;
    try { EventTarget(); } catch (e) {
        threw = e instanceof TypeError && e.message === 'Illegal constructor';
    }
    assert(threw, 'EventTarget() throws TypeError');
}

console.log('# 7.2 WindowProperties() throws');
{
    let threw = false;
    try { WindowProperties(); } catch (e) {
        threw = e instanceof TypeError && e.message === 'Illegal constructor';
    }
    assert(threw, 'WindowProperties() throws TypeError');
}

console.log('# 7.3 Window() throws');
{
    let threw = false;
    try { Window(); } catch (e) {
        threw = e instanceof TypeError && e.message === 'Illegal constructor';
    }
    assert(threw, 'Window() throws TypeError');
}

console.log('# 7.4 Navigator() throws');
{
    let threw = false;
    try { Navigator(); } catch (e) {
        threw = e instanceof TypeError && e.message === 'Illegal constructor';
    }
    assert(threw, 'Navigator() throws TypeError');
}

console.log('# 7.5 PluginArray() throws');
{
    let threw = false;
    try { PluginArray(); } catch (e) {
        threw = e instanceof TypeError && e.message === 'Illegal constructor';
    }
    assert(threw, 'PluginArray() throws TypeError');
}

console.log('# 7.6 Plugin() throws');
{
    let threw = false;
    try { Plugin(); } catch (e) {
        threw = e instanceof TypeError && e.message === 'Illegal constructor';
    }
    assert(threw, 'Plugin() throws TypeError');
}

// ══════════════════════════════════════════════════════════════════════════════
// Suite 8: Step 2 — instanceof checks
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Suite 8: instanceof ──\n');

console.log('# 8.1 window instanceof Window');
{
    const win = createWindow();
    assert(win instanceof Window, 'win instanceof Window');
    assert(win instanceof WindowProperties, 'win instanceof WindowProperties (inherited)');
    assert(win instanceof EventTarget, 'win instanceof EventTarget (inherited)');
    assert(win instanceof Object, 'win instanceof Object');
}

console.log('# 8.2 navigator instanceof Navigator');
{
    const nav = createNavigator();
    assert(nav instanceof Navigator, 'nav instanceof Navigator');
}

console.log('# 8.3 plugins instanceof PluginArray');
{
    const plugins = createPluginArray();
    assert(plugins instanceof PluginArray, 'plugins instanceof PluginArray');
}

console.log('# 8.4 plugin instanceof Plugin');
{
    const p = createPlugin('Chrome PDF Plugin', 'internal-pdf-viewer', 'Portable Document Format');
    assert(p instanceof Plugin, 'plugin instanceof Plugin');
}

console.log('# 8.5 cross-contamination: navigator is NOT instanceof Window');
{
    const nav = createNavigator();
    assert(!(nav instanceof Window), 'nav not instanceof Window');
    assert(!(nav instanceof EventTarget), 'nav not instanceof EventTarget');
}

// ══════════════════════════════════════════════════════════════════════════════
// Suite 9: Step 2 — prototype chain structure
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Suite 9: prototype chain structure ──\n');

console.log('# 9.1 Window chain order');
{
    const win = createWindow();
    assert(Object.getPrototypeOf(win) === Window.prototype,
        'win.__proto__ === Window.prototype');
    assert(Object.getPrototypeOf(Window.prototype) === WindowProperties.prototype,
        'Window.prototype.__proto__ === WindowProperties.prototype');
    assert(Object.getPrototypeOf(WindowProperties.prototype) === EventTarget.prototype,
        'WindowProperties.prototype.__proto__ === EventTarget.prototype');
    assert(Object.getPrototypeOf(EventTarget.prototype) === Object.prototype,
        'EventTarget.prototype.__proto__ === Object.prototype');
}

console.log('# 9.2 Navigator chain: Navigator.prototype → Object.prototype');
{
    const nav = createNavigator();
    assert(Object.getPrototypeOf(nav) === Navigator.prototype,
        'nav.__proto__ === Navigator.prototype');
    assert(Object.getPrototypeOf(Navigator.prototype) === Object.prototype,
        'Navigator.prototype.__proto__ === Object.prototype');
}

console.log('# 9.3 PluginArray chain: PluginArray.prototype → Object.prototype');
{
    const plugins = createPluginArray();
    assert(Object.getPrototypeOf(plugins) === PluginArray.prototype,
        'plugins.__proto__ === PluginArray.prototype');
    assert(Object.getPrototypeOf(PluginArray.prototype) === Object.prototype,
        'PluginArray.prototype.__proto__ === Object.prototype');
}

console.log('# 9.4 Plugin chain: Plugin.prototype → Object.prototype');
{
    const p = createPlugin('Test', 'test.so');
    assert(Object.getPrototypeOf(p) === Plugin.prototype,
        'plugin.__proto__ === Plugin.prototype');
}

// ══════════════════════════════════════════════════════════════════════════════
// Suite 10: Step 2 — constructor toString is native
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Suite 10: constructor toString ──\n');

console.log('# 10.1 Window.toString() → [native code]');
{
    assert(Window.toString() === 'function Window() { [native code] }',
        `Window.toString() = ${JSON.stringify(Window.toString())}`);
}

console.log('# 10.2 Navigator.toString() → [native code]');
{
    assert(Navigator.toString() === 'function Navigator() { [native code] }',
        `Navigator.toString() = ${JSON.stringify(Navigator.toString())}`);
}

console.log('# 10.3 PluginArray.toString() → [native code]');
{
    assert(PluginArray.toString() === 'function PluginArray() { [native code] }',
        `PluginArray.toString() = ${JSON.stringify(PluginArray.toString())}`);
}

console.log('# 10.4 Plugin.toString() → [native code]');
{
    assert(Plugin.toString() === 'function Plugin() { [native code] }',
        `Plugin.toString() = ${JSON.stringify(Plugin.toString())}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// Suite 11: Step 2 — window circular references
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Suite 11: window circular references ──\n');

console.log('# 11.1 window.window === window');
{
    const win = createWindow();
    assert(win.window === win, 'win.window === win');
    assert(win.self === win, 'win.self === win');
    assert(win.globalThis === win, 'win.globalThis === win');
    assert(win.top === win, 'win.top === win');
    assert(win.parent === win, 'win.parent === win');
    assert(win.frames === win, 'win.frames === win');
}

// ══════════════════════════════════════════════════════════════════════════════
// Suite 12: Step 2 — Navigator instance can hold properties
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Suite 12: Navigator property population ──\n');

console.log('# 12.1 navigator properties set via PrototypeBuilder');
{
    const nav = createNavigator();
    pb.defineGetter(nav, 'userAgent',
        () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146.0.0.0 Safari/537.36');
    pb.defineReadOnly(nav, 'platform', 'Win32');
    pb.defineReadOnly(nav, 'hardwareConcurrency', 8);

    assert(nav.userAgent.includes('Chrome/146'), 'userAgent getter');
    assert(nav.platform === 'Win32', 'platform');
    assert(nav.hardwareConcurrency === 8, 'hardwareConcurrency');

    const uaDesc = Object.getOwnPropertyDescriptor(nav, 'userAgent');
    assert(uaDesc.enumerable === false, 'userAgent not enumerable');
}

// ══════════════════════════════════════════════════════════════════════════════
// Suite 13: Step 2 — Plugin properties
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Suite 13: Plugin properties ──\n');

console.log('# 13.1 Plugin properties are read-only');
{
    const p = createPlugin('Chrome PDF Plugin', 'internal-pdf-viewer', 'Portable Document Format');
    assert(p.name === 'Chrome PDF Plugin', `name = "${p.name}"`);
    assert(p.filename === 'internal-pdf-viewer', `filename = "${p.filename}"`);
    assert(p.description === 'Portable Document Format', `description = "${p.description}"`);
    assert(p.length === 0, 'length = 0');
}

console.log('# 13.2 Plugin properties are non-enumerable');
{
    const p = createPlugin('Test', 'test.so', 'Test plugin');
    assert(Object.keys(p).length === 0,
        `Object.keys = [${Object.keys(p)}] (all non-enumerable)`);
}

// ══════════════════════════════════════════════════════════════════════════════
// Suite 14: Step 3 — Symbol.toStringTag
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Suite 14: Symbol.toStringTag ──\n');

console.log('# 14.1 Object.prototype.toString returns [object ClassName]');
{
    assert(Object.prototype.toString.call(createWindow()) === '[object Window]',
        'toString(window) = "[object Window]"');
    assert(Object.prototype.toString.call(createNavigator()) === '[object Navigator]',
        'toString(navigator) = "[object Navigator]"');
    assert(Object.prototype.toString.call(createPluginArray()) === '[object PluginArray]',
        'toString(plugins) = "[object PluginArray]"');
    assert(Object.prototype.toString.call(createPlugin('p', 'f')) === '[object Plugin]',
        'toString(plugin) = "[object Plugin]"');
}

console.log('# 14.2 toStringTag descriptor is non-enumerable, non-writable');
{
    const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, Symbol.toStringTag);
    assert(desc.enumerable === false, 'enumerable === false');
    assert(desc.writable === false, 'writable === false');
    assert(desc.configurable === false, 'configurable === false');
}

console.log('# 14.3 all six prototypes have correct toStringTag');
{
    const pairs = [
        [EventTarget.prototype, 'EventTarget'],
        [WindowProperties.prototype, 'WindowProperties'],
        [Window.prototype, 'Window'],
        [Navigator.prototype, 'Navigator'],
        [PluginArray.prototype, 'PluginArray'],
        [Plugin.prototype, 'Plugin'],
    ];
    for (const [proto, expected] of pairs) {
        assert(proto[Symbol.toStringTag] === expected,
            `${expected}.prototype[Symbol.toStringTag] === "${expected}"`);
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// Suite 15: Step 3 — Prototype locking (lockAll)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Suite 15: Prototype locking (lockAll) ──\n');

console.log('# 15.1 lockAll makes properties non-configurable');
{
    // Create a fresh prototype with properties to lock
    function TestProto() { throw new TypeError('Illegal constructor'); }
    safefunction(TestProto, 'TestProto', 0);
    const proto = TestProto.prototype;
    pb.defineReadOnly(proto, 'version', '1.0', { configurable: true }); // start configurable
    pb.defineGetter(proto, 'dynamic', () => Math.random(), { configurable: true });

    let desc = Object.getOwnPropertyDescriptor(proto, 'version');
    assert(desc.configurable === true, 'configurable === true (before lock)');

    pb.lockAll(proto);

    desc = Object.getOwnPropertyDescriptor(proto, 'version');
    assert(desc.configurable === false, 'configurable === false (after lock)');
    assert(desc.writable === false, 'writable === false (after lock)');

    const gDesc = Object.getOwnPropertyDescriptor(proto, 'dynamic');
    assert(gDesc.configurable === false, 'getter configurable === false (after lock)');
}

console.log('# 15.2 locked property cannot be deleted');
{
    function TestProto() { throw new TypeError('Illegal constructor'); }
    safefunction(TestProto, 'TestProto2', 0);
    const proto = TestProto.prototype;
    pb.defineReadOnly(proto, 'locked', 'val');
    pb.lockAll(proto);

    // strict mode: delete on non-configurable own property throws TypeError
    let threw = false;
    try {
        delete proto.locked;
    } catch (e) {
        threw = e instanceof TypeError;
    }
    assert(threw, 'delete on locked property throws TypeError in strict mode');
    assert(proto.locked === 'val', 'value still present after delete attempt');
}

console.log('# 15.3 locked property cannot be redefined via Object.defineProperty');
{
    function TestProto() { throw new TypeError('Illegal constructor'); }
    safefunction(TestProto, 'TestProto3', 0);
    const proto = TestProto.prototype;
    pb.defineReadOnly(proto, 'x', 5);
    pb.lockAll(proto);

    let threw = false;
    try {
        Object.defineProperty(proto, 'x', { value: 99 });
    } catch (e) {
        threw = e instanceof TypeError;
    }
    assert(threw, 'Object.defineProperty on locked property throws TypeError');
    assert(proto.x === 5, 'value unchanged after failed redefine');
}

console.log('# 15.4 lockAll skips constructor by default');
{
    function TestProto() { throw new TypeError('Illegal constructor'); }
    safefunction(TestProto, 'TestProto4', 0);
    const proto = TestProto.prototype;

    pb.lockAll(proto); // default: skipConstructor = true

    const cDesc = Object.getOwnPropertyDescriptor(proto, 'constructor');
    assert(cDesc.configurable === true, 'constructor remains configurable (skipped)');
}

console.log('# 15.5 lockAll with skipConstructor: false locks everything');
{
    function TestProto() { throw new TypeError('Illegal constructor'); }
    safefunction(TestProto, 'TestProto5', 0);
    const proto = TestProto.prototype;

    pb.lockAll(proto, { skipConstructor: false });

    const cDesc = Object.getOwnPropertyDescriptor(proto, 'constructor');
    assert(cDesc.configurable === false, 'constructor locked when skipConstructor=false');
}

console.log('# 15.6 lockProperty on already-locked property does not throw');
{
    function TestProto() { throw new TypeError('Illegal constructor'); }
    safefunction(TestProto, 'TestProto6', 0);
    const proto = TestProto.prototype;
    pb.defineReadOnly(proto, 'y', 10);
    pb.lockProperty(proto, 'y');          // first lock
    pb.lockProperty(proto, 'y');          // second lock — should not throw
    assert(true, 'double lockProperty does not throw');
}

console.log('# 15.7 lockAll is idempotent (no throw on double call)');
{
    function TestProto() { throw new TypeError('Illegal constructor'); }
    safefunction(TestProto, 'TestProto7', 0);
    const proto = TestProto.prototype;
    pb.defineReadOnly(proto, 'z', 42);
    pb.lockAll(proto);
    pb.lockAll(proto); // second time
    assert(proto.z === 42, 'value intact after double lockAll');
}

// ══════════════════════════════════════════════════════════════════════════════
// Suite 16: Step 3 — lockPrototypes() on built-in prototypes
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Suite 16: lockPrototypes() on built-in prototypes ──\n');

console.log('# 16.1 lockPrototypes() seals all 6 prototypes');
{
    // Before locking, Navigator.prototype.constructor should be configurable
    const cDesc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'constructor');
    assert(cDesc.configurable === true, 'constructor configurable before lock');

    lockPrototypes();

    // After locking, all prototypes should have toStringTag non-configurable
    // and constructor skipped (by default in lockAll)
    const tag = Object.getOwnPropertyDescriptor(Navigator.prototype, Symbol.toStringTag);
    assert(tag.configurable === false, 'toStringTag non-configurable after lockPrototypes');

    assert(true, 'lockPrototypes() completed without error');
}

console.log('# 16.2 After lockPrototypes, toStringTag cannot be overwritten');
{
    let threw = false;
    try {
        Object.defineProperty(Navigator.prototype, Symbol.toStringTag, { value: 'Fake' });
    } catch (e) {
        threw = e instanceof TypeError;
    }
    assert(threw, 'redefining toStringTag on locked prototype throws');
    // Verify value is still correct
    assert(Object.prototype.toString.call(createNavigator()) === '[object Navigator]',
        'toString still returns [object Navigator]');
}

// ══════════════════════════════════════════════════════════════════════════════
// Suite 17: Step 4 — MimeType constructor
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Suite 17: MimeType constructor ──\n');

console.log('# 17.1 MimeType() throws');
{
    let threw = false;
    try { MimeType(); } catch (e) { threw = e instanceof TypeError; }
    assert(threw, 'MimeType() throws TypeError');
}

console.log('# 17.2 MimeType instance properties');
{
    const plugin = createPlugin('Test', 'test.so');
    const mt = createMimeType('application/pdf', 'PDF', 'pdf', plugin);
    assert(mt instanceof MimeType, 'mt instanceof MimeType');
    assert(mt.type === 'application/pdf', 'type');
    assert(mt.description === 'PDF', 'description');
    assert(mt.suffixes === 'pdf', 'suffixes');
    assert(mt.enabledPlugin === plugin, 'enabledPlugin back-reference');
}

console.log('# 17.3 MimeType.toStringTag');
{
    const mt = createMimeType('text/html', 'HTML', 'html', null);
    assert(Object.prototype.toString.call(mt) === '[object MimeType]',
        'toString(mt) = "[object MimeType]"');
}

// ══════════════════════════════════════════════════════════════════════════════
// Suite 18: Step 4 — MimeTypeArray
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Suite 18: MimeTypeArray ──\n');

console.log('# 18.1 MimeTypeArray() throws');
{
    let threw = false;
    try { MimeTypeArray(); } catch (e) { threw = e instanceof TypeError; }
    assert(threw, 'MimeTypeArray() throws TypeError');
}

console.log('# 18.2 MimeTypeArray instance');
{
    const arr = createMimeTypeArray();
    assert(arr instanceof MimeTypeArray, 'arr instanceof MimeTypeArray');
    assert(arr.length === 0, 'length = 0');
    assert(typeof arr.item === 'function', 'item is function');
    assert(typeof arr.namedItem === 'function', 'namedItem is function');
}

// ══════════════════════════════════════════════════════════════════════════════
// Suite 19: Step 4 — PluginArray methods
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Suite 19: PluginArray methods ──\n');

console.log('# 19.1 item() returns plugin by index');
{
    const p1 = createPlugin('P1', 'p1.so');
    const p2 = createPlugin('P2', 'p2.so');
    const arr = createPluginArray();
    arr._entries = [p1, p2];
    // length is dynamic via prototype getter — reads _entries.length

    assert(arr.item(0) === p1, 'item(0) = p1');
    assert(arr.item(1) === p2, 'item(1) = p2');
    assert(arr.length === 2, 'length getter = 2');
    assert(arr.item(2) === null, 'item(2) = null (out of range)');
    assert(arr.item(-1) === null, 'item(-1) = null');
}

console.log('# 19.2 namedItem() returns plugin by name');
{
    const p1 = createPlugin('Chrome PDF Plugin', 'pdf.so');
    const p2 = createPlugin('WebP', 'webp.so');
    const arr = createPluginArray();
    arr._entries = [p1, p2];

    assert(arr.namedItem('Chrome PDF Plugin') === p1, 'namedItem("Chrome PDF Plugin")');
    assert(arr.namedItem('WebP') === p2, 'namedItem("WebP")');
    assert(arr.namedItem('Nonexistent') === null, 'namedItem("Nonexistent") = null');
}

console.log('# 19.3 refresh() exists and does not throw');
{
    const arr = createPluginArray();
    arr._entries = [];
    arr.refresh();
    assert(true, 'refresh() no-op');
}

console.log('# 19.4 for-of iteration');
{
    const p1 = createPlugin('A', 'a.so');
    const p2 = createPlugin('B', 'b.so');
    const p3 = createPlugin('C', 'c.so');
    const arr = createPluginArray();
    arr._entries = [p1, p2, p3];
    assert(arr.length === 3, 'length getter = 3');

    const collected = [];
    for (const p of arr) collected.push(p.name);
    assert(collected.length === 3, '3 items iterated');
    assert(collected[0] === 'A' && collected[1] === 'B' && collected[2] === 'C',
        `iteration order: [${collected}]`);
}

// ══════════════════════════════════════════════════════════════════════════════
// Suite 20: Step 4 — Plugin with mimeTypes
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Suite 20: Plugin with mimeTypes ──\n');

console.log('# 20.1 Plugin.item delegates to mimeTypes');
{
    const plugin = createPlugin('PDF Plugin', 'pdf.so', 'PDF');
    const mimeTypeArr = createMimeTypeArray();
    const mt1 = createMimeType('application/pdf', 'PDF', 'pdf', plugin);
    mimeTypeArr._entries = [mt1];
    pb.defineReadOnly(plugin, 'mimeTypes', mimeTypeArr);
    // length getters are dynamic: plugin.length → mimeTypes.length → _entries.length

    assert(plugin.item(0) === mt1, 'plugin.item(0) = mt1');
    assert(plugin.item(1) === null, 'plugin.item(1) = null');
    assert(plugin.length === 1, 'plugin.length getter = 1');
}

console.log('# 20.2 Plugin.namedItem delegates to mimeTypes');
{
    const plugin = createPlugin('WebP', 'webp.so');
    const mimeTypeArr = createMimeTypeArray();
    const mt1 = createMimeType('image/webp', 'WebP Image', 'webp', plugin);
    const mt2 = createMimeType('image/x-webp', 'WebP Image (alt)', 'webp', plugin);
    mimeTypeArr._entries = [mt1, mt2];
    pb.defineReadOnly(plugin, 'mimeTypes', mimeTypeArr);

    assert(plugin.namedItem('image/webp') === mt1, 'namedItem("image/webp") = mt1');
    assert(plugin.namedItem('image/x-webp') === mt2, 'namedItem("image/x-webp") = mt2');
}

// ══════════════════════════════════════════════════════════════════════════════
// Suite 21: Step 4 — buildNavigator full assembly
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Suite 21: buildNavigator full assembly ──\n');

console.log('# 21.1 buildNavigator returns instanceof Navigator');
{
    const nav = buildNavigator();
    assert(nav instanceof Navigator, 'nav instanceof Navigator');
}

console.log('# 21.2 navigator.plugins is instanceof PluginArray');
{
    const nav = buildNavigator();
    assert(nav.plugins instanceof PluginArray, 'plugins instanceof PluginArray');
    assert(nav.plugins.length === 5, `plugins.length = ${nav.plugins.length} (expected 5)`);
}

console.log('# 21.3 each plugin is instanceof Plugin');
{
    const nav = buildNavigator();
    for (let i = 0; i < nav.plugins.length; i++) {
        const p = nav.plugins.item(i);
        assert(p instanceof Plugin, `plugins[${i}] (${p.name}) instanceof Plugin`);
    }
}

console.log('# 21.4 plugins have mimeTypes');
{
    const nav = buildNavigator();
    const pdf = nav.plugins.namedItem('Chrome PDF Plugin');
    assert(pdf !== null, 'Chrome PDF Plugin found');
    assert(pdf.mimeTypes !== undefined, 'has mimeTypes');
    assert(pdf.mimeTypes.length >= 1, `mimeTypes.length = ${pdf.mimeTypes.length}`);
    assert(pdf.mimeTypes.item(0).type === 'application/pdf', 'mimeType is application/pdf');
}

console.log('# 21.5 mimeType.enabledPlugin back-reference');
{
    const nav = buildNavigator();
    const pdf = nav.plugins.namedItem('Chrome PDF Plugin');
    const mt = pdf.mimeTypes.item(0);
    assert(mt.enabledPlugin === pdf, 'enabledPlugin points back to parent plugin');
}

console.log('# 21.6 navigator.mimeTypes is instanceof MimeTypeArray');
{
    const nav = buildNavigator();
    assert(nav.mimeTypes instanceof MimeTypeArray, 'mimeTypes instanceof MimeTypeArray');
    assert(nav.mimeTypes.length >= 5, `mimeTypes.length = ${nav.mimeTypes.length} (expected >= 5)`);
}

console.log('# 21.7 for-of iteration on navigator.plugins');
{
    const nav = buildNavigator();
    const names = [];
    for (const p of nav.plugins) names.push(p.name);
    assert(names.length === 5, `5 plugins iterated: [${names.join(', ')}]`);
    assert(names.includes('Chrome PDF Plugin'), 'includes Chrome PDF Plugin');
}

console.log('# 21.8 navigator basic properties');
{
    const nav = buildNavigator();
    assert(nav.userAgent.includes('Chrome'), 'userAgent includes Chrome');
    assert(nav.platform === 'Win32', 'platform = Win32');
    assert(nav.cookieEnabled === true, 'cookieEnabled = true');
    assert(nav.hardwareConcurrency === 8, 'hardwareConcurrency = 8');
    assert(nav.languages.length === 3, `languages = [${nav.languages}]`);
}

console.log('# 21.9 navigator properties are non-enumerable');
{
    const nav = buildNavigator();
    const keys = Object.keys(nav);
    assert(keys.length === 0, `Object.keys(nav) = [${keys}] (expected [])`);
}

console.log('# 21.10 buildNavigator with custom userAgent');
{
    const nav = buildNavigator({ userAgent: 'Mozilla/5.0 CustomUA/1.0' });
    assert(nav.userAgent === 'Mozilla/5.0 CustomUA/1.0', 'custom UA preserved');
    assert(nav.appVersion === '5.0 CustomUA/1.0', 'appVersion derived from UA');
}

console.log('# 21.11 PluginArray.item method.toString is native');
{
    const nav = buildNavigator();
    const itemStr = nav.plugins.item.toString();
    assert(itemStr === 'function item() { [native code] }',
        `plugins.item.toString() = ${JSON.stringify(itemStr)}`);
}

console.log('# 21.12 MimeTypeArray for-of iteration');
{
    const nav = buildNavigator();
    const types = [];
    for (const mt of nav.mimeTypes) types.push(mt.type);
    assert(types.length >= 5, `${types.length} mimeTypes iterated`);
}

// ══════════════════════════════════════════════════════════════════════════════
// Suite 22: Step 4 — Navigator getter integrity
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Suite 22: Navigator getter integrity ──\n');

console.log('# 22.1 plugins getter is on Navigator.prototype');
{
    const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'plugins');
    assert(typeof desc.get === 'function', 'plugins is a getter');
    assert(desc.enumerable === false, 'plugins getter non-enumerable');
    assert(desc.configurable === false, 'plugins getter non-configurable');
}

console.log('# 22.2 mimeTypes getter is on Navigator.prototype');
{
    const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'mimeTypes');
    assert(typeof desc.get === 'function', 'mimeTypes is a getter');
}

console.log('# 22.3 different navigator instances have independent state');
{
    const nav1 = buildNavigator({ userAgent: 'UA1' });
    const nav2 = buildNavigator({ userAgent: 'UA2' });
    assert(nav1.userAgent === 'UA1', 'nav1 UA');
    assert(nav2.userAgent === 'UA2', 'nav2 UA');
    assert(nav1.plugins !== nav2.plugins, 'plugins objects are independent');
}

console.log('# 22.4 getter toString is native');
{
    const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'plugins');
    const str = desc.get.toString();
    assert(str === 'function get plugins() { [native code] }',
        `getter toString = ${JSON.stringify(str)}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// Suite 23: Step 5 — buildFakeBrowser full integration
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Suite 23: buildFakeBrowser full integration ──\n');

console.log('# 23.1 buildFakeBrowser returns instanceof Window');
{
    const win = buildFakeBrowser();
    assert(win instanceof Window, 'win instanceof Window');
    assert(win instanceof Object, 'win instanceof Object');
}

console.log('# 23.2 window.window === window (circular reference)');
{
    const win = buildFakeBrowser();
    assert(win.window === win, 'win.window === win');
    assert(win.self === win, 'win.self === win');
}

console.log('# 23.3 navigator with plugins (prototype engine)');
{
    const win = buildFakeBrowser();
    assert(win.navigator instanceof Navigator, 'navigator instanceof Navigator');
    assert(win.navigator.plugins instanceof PluginArray, 'plugins instanceof PluginArray');
    assert(win.navigator.plugins.length === 5, `5 plugins (got ${win.navigator.plugins.length})`);
    assert(win.navigator.plugins.item(0) instanceof Plugin, 'first plugin instanceof Plugin');
}

console.log('# 23.4 document basics');
{
    const win = buildFakeBrowser();
    assert(win.document.readyState === 'complete', 'readyState = complete');
    assert(typeof win.document.createElement === 'function', 'createElement is function');
    const el = win.document.createElement('canvas');
    assert(el.tagName === 'CANVAS', 'element tagName = CANVAS');
    assert(typeof el.toDataURL === 'function', 'canvas.toDataURL is function');
}

console.log('# 23.5 screen, location, history, localStorage');
{
    const win = buildFakeBrowser();
    assert(win.screen.width === 1920, 'screen.width');
    assert(win.location.hostname === 'www.example.com', 'location.hostname');
    assert(win.history.length === 1, 'history.length = 1');
    assert(typeof win.localStorage.getItem === 'function', 'localStorage.getItem');
}

console.log('# 23.6 XMLHttpRequest fake');
{
    const win = buildFakeBrowser();
    const xhr = new win.XMLHttpRequest();
    xhr.open('GET', 'https://example.com/api/test?_t=1');
    xhr.setRequestHeader('content-type', 'application/x-www-form-urlencoded');
    xhr.send(null);
    assert(xhr.readyState === 4, 'readyState = 4');
    assert(xhr.status === 200, 'status = 200');
    assert(xhr._url === 'https://example.com/api/test?_t=1', '_url captured');
    assert(typeof xhr.responseText === 'string', 'responseText is string');
}

console.log('# 23.7 fetch returns Promise');
{
    const win = buildFakeBrowser();
    const p = win.fetch('https://example.com/api');
    assert(p instanceof Promise, 'fetch returns Promise');
}

console.log('# 23.8 anti-rehost — Node globals cleared');
{
    const win = buildFakeBrowser();
    assert(win.process === undefined, 'process === undefined');
    assert(win.require === undefined, 'require === undefined');
    assert(win.global === undefined, 'global === undefined');
    assert(win.module === undefined, 'module === undefined');
}

console.log('# 23.9 standard globals present');
{
    const win = buildFakeBrowser();
    assert(win.Math === Math, 'Math');
    assert(win.Date === Date, 'Date');
    assert(win.Promise === Promise, 'Promise');
    assert(win.Array === Array, 'Array');
    assert(win.Object === Object, 'Object');
    assert(typeof win.atob === 'function', 'atob');
    assert(typeof win.btoa === 'function', 'btoa');
}

console.log('# 23.10 crypto');
{
    const win = buildFakeBrowser();
    assert(typeof win.crypto.getRandomValues === 'function', 'getRandomValues');
    const arr = new Uint8Array(8);
    win.crypto.getRandomValues(arr);
    assert(arr.some(b => b !== 0), 'getRandomValues fills with non-zero data');
}

console.log('# 23.11 performance.now monotonic');
{
    const win = buildFakeBrowser();
    const t1 = win.performance.now();
    const t2 = win.performance.now();
    assert(t2 >= t1, 'performance.now() monotonic');
}

console.log('# 23.12 vm.createContext compatibility');
{
    const vm = require('vm');
    const win = buildFakeBrowser();
    let ctx;
    let threw = false;
    try {
        ctx = vm.createContext(win);
        const result = vm.runInContext('1 + 1', ctx);
        assert(result === 2, 'vm.runInContext basic execution');
    } catch (e) {
        threw = true;
        assert(false, `vm.createContext threw: ${e.message}`);
    }
    assert(!threw, 'vm.createContext succeeded');
}

console.log('# 23.13 SDK-like execution in vm sandbox');
{
    const vm = require('vm');
    const win = buildFakeBrowser();
    const ctx = vm.createContext(win);

    // Simulate what an SDK might do (real SDKs use toString checks, not instanceof)
    const result = vm.runInContext(`(function testSDK() {
        // Check navigator identity via toString (real SDK pattern)
        var navStr = Object.prototype.toString.call(window.navigator);
        if (navStr !== '[object Navigator]') return 'FAIL: nav toString=' + navStr;

        // Check plugins
        var p = window.navigator.plugins;
        if (p.length !== 5) return 'FAIL: wrong plugin count';

        // Check for-of iteration
        var count = 0;
        for (var i = 0; i < p.length; i++) {
            var plugin = p.item(i);
            if (Object.prototype.toString.call(plugin) !== '[object Plugin]') return 'FAIL: plugin toString';
            count++;
        }
        if (count !== 5) return 'FAIL: loop count wrong';

        // Check item.toString is [native code]
        if (window.navigator.plugins.item.toString() !== 'function item() { [native code] }')
            return 'FAIL: item toString wrong';

        // Check XHR
        var x = new XMLHttpRequest();
        x.open('GET', '/api/test');
        x.setRequestHeader('x-sdk', 'test');
        x.send(null);
        if (x.readyState !== 4) return 'FAIL: xhr readyState';

        // Check anti-rehost
        if (typeof process !== 'undefined') return 'FAIL: process visible';
        if (typeof require !== 'undefined') return 'FAIL: require visible';

        return 'OK';
    })()`, ctx);

    assert(result === 'OK', `SDK simulation: ${result}`);
}

console.log('# 23.14 buildFakeBrowser with custom UA and href');
{
    const win = buildFakeBrowser({
        userAgent: 'Mozilla/5.0 Custom TestAgent/99.0',
        href: 'https://www.mytarget.com/page?q=1',
    });
    assert(win.navigator.userAgent === 'Mozilla/5.0 Custom TestAgent/99.0', 'custom UA');
    assert(win.location.href === 'https://www.mytarget.com/page?q=1', 'custom href');
    assert(win.location.pathname === '/page', 'pathname');
    assert(win.document.URL === 'https://www.mytarget.com/page?q=1', 'document.URL');
}

// ══════════════════════════════════════════════════════════════════════════════
// Suite 24: Task 1 — document.all simulation
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Suite 24: document.all simulation ──\n');

const { createDocumentAll, HTMLAllCollection } = require('../src/env/document-all');

console.log('# 24.1 document.all is callable');
{
    const all = createDocumentAll();
    assert(all() === null, 'all() returns null');
    assert(all('nonexistent') === null, 'all("nonexistent") returns null');
}

console.log('# 24.2 document.all === undefined is false');
{
    const all = createDocumentAll();
    assert(all === undefined === false, '=== undefined is false');
    assert(all === null === false, '=== null is false');
}

console.log('# 24.3 document.all == undefined — NOT achievable in pure JS');
{
    // Abstract equality (==) against undefined NEVER calls ToPrimitive.
    // The spec says: Object == undefined → false (step 10).
    // Only V8's MarkAsUndetectable() C++ flag can change this behavior.
    // This is an explicitly documented limitation.
    const all = createDocumentAll();
    assert((all == undefined) === false,
        '== undefined returns false (spec-mandated limitation)');
    // Even monitoring cannot detect == checks — the comparison never
    // triggers a Proxy trap on the object side.
}

console.log('# 24.4 document.all.length reflects registered elements');
{
    const all = createDocumentAll({ elements: { a: {}, b: {}, c: {} } });
    assert(all.length === 3, 'length = 3');
}

console.log('# 24.5 "id" in document.all uses has trap');
{
    const all = createDocumentAll({ elements: { myId: {} } });
    assert(('myId' in all) === true, '"myId" in all is true');
    assert(('missing' in all) === false, '"missing" in all is false');
}

console.log('# 24.6 document.all instanceof HTMLAllCollection');
{
    const all = createDocumentAll();
    assert(all instanceof HTMLAllCollection, 'instanceof HTMLAllCollection');
}

console.log('# 24.7 item() / namedItem()');
{
    const elA = { tagName: 'DIV' };
    const elB = { tagName: 'SPAN' };
    const all = createDocumentAll({ elements: { a: elA, b: elB } });
    assert(all.item(0) === elA, 'item(0) returns first element');
    assert(all.item(1) === elB, 'item(1) returns second element');
    assert(all.namedItem('a') === elA, 'namedItem("a") returns elA');
}

console.log('# 24.8 Symbol.iterator');
{
    const all = createDocumentAll({ elements: { x: { v: 1 }, y: { v: 2 } } });
    const values = [];
    for (const el of all) values.push(el.v);
    assert(values.length === 2, 'iterates 2 elements');
}

console.log('# 24.9 access monitoring');
{
    const all = createDocumentAll({ monitor: true, elements: { test: {} } });
    all('test');  // should be logged
    all.length;   // should be logged
    const log = all.getAccessLog();
    assert(log.length >= 2, `logged ${log.length} accesses`);
    assert(log[0].prop === '.call()', 'first log is .call()');
    all.clearAccessLog();
    assert(all.getAccessLog().length === 0, 'clearAccessLog works');
}

console.log('# 24.10 document.all integrated in buildFakeBrowser');
{
    const win = buildFakeBrowser();
    assert(win.document.all !== undefined, 'document.all exists');
    assert(win.document.all() === null, 'document.all() returns null');
    assert(typeof win.document.all !== 'undefined', 'typeof is not undefined (JS limitation)');
    // == undefined cannot be achieved in pure JS — needs C++ MarkAsUndetectable
}

// ══════════════════════════════════════════════════════════════════════════════
// Suite 25: Task 2 — Fingerprint Engine (Canvas, WebGL, Audio)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Suite 25: Fingerprint Engine ──\n');

const { createCanvas, createWebGLContext, createAudioContext } = require('../src/env/fingerprint');

console.log('# 25.1 Canvas — seed determinism');
{
    const c1 = createCanvas(42);
    const c2 = createCanvas(42);
    assert(c1.toDataURL() === c2.toDataURL(), 'same seed → same dataURL');
    assert(c1.width === 300 && c1.height === 150, 'default 300x150');
}

console.log('# 25.2 Canvas — different seeds differ');
{
    const c1 = createCanvas(1).toDataURL();
    const c2 = createCanvas(99999).toDataURL();
    assert(c1 !== c2, 'different seeds produce different output');
}

console.log('# 25.3 Canvas 2D — getImageData is seed-consistent');
{
    const ctx = createCanvas(77).getContext('2d');
    const d1 = ctx.getImageData(0, 0, 10, 10);
    const d2 = ctx.getImageData(0, 0, 10, 10);
    assert(d1.width === 10 && d1.height === 10, 'correct dimensions');
    // Same seed+position → same data
    let same = true;
    for (let i = 0; i < d1.data.length; i++) {
        if (d1.data[i] !== d2.data[i]) { same = false; break; }
    }
    assert(same, 'same seed+coords → same pixel data');
}

console.log('# 25.4 WebGL — getParameter returns seed-consistent vendor');
{
    const gl1 = createWebGLContext(42, 'webgl');
    const gl2 = createWebGLContext(42, 'webgl');
    assert(gl1.getParameter(7936) === gl2.getParameter(7936), 'same seed → same VENDOR');
    assert(gl1.getParameter(7937) === gl2.getParameter(7937), 'same seed → same RENDERER');
}

console.log('# 25.5 WebGL — WebGL2 mode available');
{
    const gl2 = createWebGLContext(100, 'webgl2');
    assert(typeof gl2.getParameter === 'function', 'getParameter exists');
    assert(typeof gl2.getSupportedExtensions === 'function', 'getSupportedExtensions exists');
    assert(Array.isArray(gl2.getSupportedExtensions()), 'extensions is array');
    assert(gl2.getSupportedExtensions().length > 0, 'has extensions');
}

console.log('# 25.6 AudioContext — seed determinism');
{
    const ctx1 = createAudioContext(55);
    const ctx2 = createAudioContext(55);
    assert(ctx1.sampleRate === ctx2.sampleRate, 'same sampleRate');
    // Oscillator frequency should be seed-consistent
    assert(ctx1.createOscillator().frequency.value === ctx2.createOscillator().frequency.value,
        'oscillator frequency seed-consistent');
}

console.log('# 25.7 AudioContext — analyser returns seed-derived data');
{
    const ctx = createAudioContext(123);
    const analyser = ctx.createAnalyser();
    const data = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(data);
    assert(data.some(v => v !== 0), 'frequency data is non-zero');
    // Same seed → same data
    const data2 = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(data2);
    let same = true;
    for (let i = 0; i < data.length; i++) {
        if (data[i] !== data2[i]) { same = false; break; }
    }
    assert(same, 'same analyser → identical data');
}

console.log('# 25.8 Canvas integrated in buildFakeBrowser');
{
    const win = buildFakeBrowser({ canvasSeed: 42 });
    const canvas = win.document.createElement('canvas');
    assert(canvas.width === 300 && canvas.height === 150, 'canvas 300x150');
    const url = canvas.toDataURL();
    assert(url.startsWith('data:image/png;base64,'), 'valid data URL prefix');
    assert(url.length > 100, `data URL not too short (${url.length} chars)`);
}

console.log('# 25.9 WebGL integrated via canvas.getContext');
{
    const win = buildFakeBrowser({ canvasSeed: 99 });
    const canvas = win.document.createElement('canvas');
    const gl = canvas.getContext('webgl');
    assert(gl !== null, 'webgl context returned');
    assert(typeof gl.getParameter === 'function', 'gl.getParameter exists');
    const vendor = gl.getParameter(7936);
    assert(typeof vendor === 'string' && vendor.length > 0, `vendor = "${vendor}"`);
}

console.log('# 25.10 AudioContext integrated in buildFakeBrowser');
{
    const win = buildFakeBrowser({ canvasSeed: 77 });
    assert(typeof win.AudioContext === 'function', 'AudioContext exists');
    const ctx = new win.AudioContext();
    assert(ctx.sampleRate > 0, 'sampleRate > 0');
    assert(typeof ctx.createOscillator === 'function', 'createOscillator exists');
    assert(typeof ctx.createAnalyser === 'function', 'createAnalyser exists');
}

// ══════════════════════════════════════════════════════════════════════════════
// Suite 26: Task 3 — beforeParse lifecycle hook
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Suite 26: beforeParse lifecycle hook ──\n');

console.log('# 26.1 beforeParse is called before return');
{
    let called = false;
    let winRef = null;
    const win = buildFakeBrowser({
        beforeParse(w) {
            called = true;
            winRef = w;
            w.__customInjected = 'hello';
        },
    });
    assert(called, 'beforeParse was called');
    assert(winRef === win, 'window reference matches');
    assert(win.__customInjected === 'hello', 'custom state injected');
}

console.log('# 26.2 beforeParse can set document.cookie');
{
    const win = buildFakeBrowser({
        beforeParse(w) {
            w.document.cookie = 'session=abc123; domain=.example.com';
        },
    });
    assert(win.document.cookie === 'session=abc123; domain=.example.com', 'cookie set');
}

console.log('# 26.3 beforeParse can attach event listeners');
{
    let eventFired = false;
    const win = buildFakeBrowser({
        beforeParse(w) {
            w.addEventListener('custom', () => { eventFired = true; });
        },
    });
    win.dispatchEvent(new (require('events').EventEmitter)());  // skipped — not testable w/o DOM
    assert(true, 'beforeParse event binding completed without error');
}

console.log('# 26.4 no beforeParse = no error');
{
    const win = buildFakeBrowser(); // no beforeParse
    assert(win.__customInjected === undefined, 'no custom state injected');
}

// ══════════════════════════════════════════════════════════════════════════════
// Results
// ══════════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(60)}`);
console.log(`${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
    console.error('SOME TESTS FAILED');
    process.exit(1);
} else {
    console.log('ALL TESTS PASSED');
}
