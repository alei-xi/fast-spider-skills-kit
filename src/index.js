// src/index.js
// Toolkit — unified entry point for the browser environment patching engine.
//
// Quick start:
//   const Toolkit = require('./src');
//   const win = Toolkit.createBrowser({ userAgent: '...', href: 'https://...' });
//   const ctx = require('vm').createContext(win);
//
// Config-driven:
//   const win = Toolkit.createBrowserFromConfig(
//     Toolkit.loadConfig('./config/targets/jd.json')
//   );
//
// Advanced GPU:
//   Toolkit.Fingerprint.setProfile('nvidia_desktop');
//   const win = Toolkit.createBrowser({ canvasSeed: 42 });

'use strict';

const fs = require('fs');
const path = require('path');
const { buildFakeBrowser } = require('./env/browser');
const { createDocumentAll, HTMLAllCollection } = require('./env/document-all');
const fingerprint = require('./env/fingerprint');

// ── Platform resolver ───────────────────────────────────────────────────────

const DEFAULT_PLATFORMS_DIR = path.resolve(__dirname, '..', 'platforms');

/**
 * Resolve a platform name to its directory on disk.
 * Searches: 1) explicit dir  2) name under default platforms/  3) name as absolute path
 */
function resolvePlatformDir(name, platformsDir) {
    const base = platformsDir || DEFAULT_PLATFORMS_DIR;
    const candidates = [
        name,                                          // absolute path
        path.join(base, name),                          // default platforms/<name>
        path.join(process.cwd(), name),                 // relative to cwd
        path.join(process.cwd(), 'platforms', name),    // relative cwd/platforms/<name>
    ];
    for (const dir of candidates) {
        if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
            return dir;
        }
    }
    return null;
}

/**
 * Load a platform by name.  The platform directory must contain:
 *   - config.json  (platform-specific configuration)
 *   - index.js     (class extending BasePlatform or duck-typed equivalent)
 */
function loadPlatform(name, platformsDir) {
    const dir = resolvePlatformDir(name, platformsDir);
    if (!dir) {
        throw new Error(
            `Platform "${name}" not found. Searched under: ${platformsDir || DEFAULT_PLATFORMS_DIR}`
        );
    }

    const indexPath = path.join(dir, 'index.js');
    if (!fs.existsSync(indexPath)) {
        throw new Error(`Platform entry not found: ${indexPath}`);
    }

    const PlatformClass = require(indexPath);

    // Support both: class with static .load(), and direct constructor
    let instance;
    if (typeof PlatformClass.load === 'function') {
        instance = PlatformClass.load(dir);
    } else {
        const config = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
        instance = new PlatformClass(config);
    }

    // Duck-type validation
    if (typeof instance.getFingerprintOptions !== 'function') {
        throw new Error(`Platform "${name}": missing getFingerprintOptions()`);
    }
    if (typeof instance.getBeforeParseHook !== 'function') {
        throw new Error(`Platform "${name}": missing getBeforeParseHook()`);
    }
    if (typeof instance.getScrapeConfig !== 'function') {
        throw new Error(`Platform "${name}": missing getScrapeConfig()`);
    }

    return instance;
}

/**
 * Merge platform overrides into the global config.
 * Platform's getFingerprintOptions, getBeforeParseHook, getScrapeConfig
 * take precedence over base config values.
 */
function applyPlatform(platform, config) {
    const fp = platform.getFingerprintOptions() || {};
    const scrape = platform.getScrapeConfig() || {};

    // Merge fingerprint options
    const merged = _deepMerge(config || {}, {
        fingerprint: {
            seed: fp.canvasSeed !== undefined ? fp.canvasSeed : undefined,
            canvas_dimensions: (fp.canvasWidth && fp.canvasHeight)
                ? { width: fp.canvasWidth, height: fp.canvasHeight } : undefined,
        },
        webgl: {
            profile: fp.webglProfile || undefined,
        },
        scrape: scrape,
    });

    // Strip undefined values from shallow merge
    function clean(obj) {
        if (Array.isArray(obj)) return obj;
        if (obj && typeof obj === 'object') {
            const r = {};
            for (const k of Object.keys(obj)) {
                const v = clean(obj[k]);
                if (v !== undefined) r[k] = v;
            }
            return r;
        }
        return obj;
    }

    return { config: clean(merged), platform };
}

// ── GPU profile presets ─────────────────────────────────────────────────────

const GPU_PROFILES = {
    // Maps profile name → index into GPU_POOL
    intel_integrated: 0,       // Intel Iris OpenGL Engine
    nvidia_desktop: 1,         // NVIDIA GeForce RTX 3080
    intel_xe: 2,               // Intel Iris Xe Graphics
    amd_desktop: 3,            // AMD Radeon Pro 5500M
    angle_intel: 4,            // ANGLE (Intel UHD 630, Direct3D11)
};

/**
 * Pin the GPU pool to a single named profile.
 * Subsequent createBrowser() calls use only the selected GPU.
 */
function setGPUProfile(name) {
    if (!(name in GPU_PROFILES)) {
        throw new Error(
            `Unknown GPU profile "${name}". Available: ${Object.keys(GPU_PROFILES).join(', ')}`
        );
    }
    const idx = GPU_PROFILES[name];
    const profile = fingerprint.GPU_POOL[idx];
    // Replace pool contents with the single selected profile
    fingerprint.GPU_POOL.splice(0, fingerprint.GPU_POOL.length, profile);
    return profile;
}

/**
 * Get available GPU profile names.
 */
function listGPUProfiles() {
    return Object.keys(GPU_PROFILES);
}

/**
 * Get full GPU pool details for inspection.
 */
function getGPUProfiles() {
    return fingerprint.GPU_POOL.map((p, i) => {
        const name = Object.keys(GPU_PROFILES).find(k => GPU_PROFILES[k] === i);
        return { index: i, name: name || 'custom', vendor: p.vendor, renderer: p.renderer };
    });
}

// ── Config loader ───────────────────────────────────────────────────────────

/**
 * Load a JSON configuration file from disk.
 *
 * @param {string} configPath — absolute or relative path to a .json config
 * @returns {Object} parsed config object
 */
function loadConfig(configPath) {
    const resolved = path.isAbsolute(configPath)
        ? configPath
        : path.resolve(process.cwd(), configPath);
    if (!fs.existsSync(resolved)) {
        throw new Error(`Config file not found: ${resolved}`);
    }
    let raw = fs.readFileSync(resolved, 'utf8');
    // Strip comment lines (lines that are ONLY a "// ..." string)
    // and fix comment keys missing values by appending :""
    raw = raw.split('\n').map(line => {
        // Line that is just:  "// ...",
        if (/^\s*"\/\/[^"]*",?\s*$/.test(line)) return '';
        // Line like: "// key"  (missing colon+value before comma or newline)
        if (/^\s*"\/\/[^"]*"\s*$/.test(line.trimEnd().replace(/,$/, ''))) {
            return line.replace(/("\s*)$/, ':""$1');
        }
        return line;
    }).filter(line => line !== '').join('\n');
    const config = JSON.parse(raw);
    // Strip comment keys after parse as safety net
    return _stripComments(config);
}

function _stripComments(obj) {
    if (Array.isArray(obj)) {
        return obj.map(_stripComments);
    }
    if (obj && typeof obj === 'object') {
        const result = {};
        for (const key of Object.keys(obj)) {
            if (key.startsWith('//') || key.startsWith('$')) continue;
            result[key] = _stripComments(obj[key]);
        }
        return result;
    }
    return obj;
}

/**
 * Create a fake browser window from a loaded config object.
 *
 * Maps the config template fields to buildFakeBrowser options,
 * auto-wires GPU profile selection, fingerprint seed, document.all
 * monitoring, and beforeParse script injection.
 *
 * @param {Object} config — parsed config object (from loadConfig or inline)
 * @param {Object} [overrides] — optional per-call overrides for any config field
 * @returns {Object} window suitable for vm.createContext()
 */
function createBrowserFromConfig(config, overrides) {
    const c = _deepMerge(config, overrides || {});

    // Resolve seed
    let canvasSeed = c.fingerprint && c.fingerprint.seed;
    if (canvasSeed === 'random' || canvasSeed === undefined || canvasSeed === null) {
        canvasSeed = Date.now();
    }

    // Apply GPU profile
    if (c.webgl && c.webgl.profile && c.webgl.profile !== 'random' && c.webgl.profile !== 'custom') {
        setGPUProfile(c.webgl.profile);
    }
    if (c.webgl && c.webgl.profile === 'custom' && c.webgl.gpu_pool_override) {
        fingerprint.GPU_POOL.splice(0, fingerprint.GPU_POOL.length, ...c.webgl.gpu_pool_override);
    }

    // Build beforeParse script
    let beforeParse = undefined;
    if (c.lifecycle && c.lifecycle.before_parse) {
        const script = String(c.lifecycle.before_parse);
        beforeParse = function (win) {
            const hostname = win.location.hostname;
            const ts = Date.now();
            try {
                // eslint-disable-next-line no-new-func
                const fn = new Function('win', 'hostname', 'ts', script);
                fn(win, hostname, ts);
            } catch (e) {
                win.console.error('[Toolkit] before_parse script error:', e.message);
            }
        };
    }

    // Build options
    const ua = (c.browser && c.browser.user_agent) || undefined;
    const href = (c.target && c.target.test_url) || 'https://www.example.com/';

    const opts = {
        userAgent: ua,
        href: href,
        canvasSeed: canvasSeed,
        debugAll: !!(c.document_all && c.document_all.monitoring_enabled),
        beforeParse: beforeParse,
    };

    const win = buildFakeBrowser(opts);

    // Post-create script
    if (c.lifecycle && c.lifecycle.after_create) {
        try {
            // eslint-disable-next-line no-new-func
            const fn = new Function('win', String(c.lifecycle.after_create));
            fn(win);
        } catch (e) {
            win.console.error('[Toolkit] after_create script error:', e.message);
        }
    }

    return win;
}

// ── Shallow merge (overrides win over config) ───────────────────────────────

function _deepMerge(base, overrides) {
    const result = Object.assign({}, base);
    for (const key of Object.keys(overrides)) {
        if (overrides[key] && typeof overrides[key] === 'object' && !Array.isArray(overrides[key])) {
            result[key] = _deepMerge(base[key] || {}, overrides[key]);
        } else {
            result[key] = overrides[key];
        }
    }
    return result;
}

// ── Toolkit object ──────────────────────────────────────────────────────────

const Toolkit = {
    // ── Primary API ────────────────────────────────────────────────────────

    /**
     * Create a fully-assembled fake browser window (programmatic API).
     *
     * If `options.platform` is set, auto-loads the named platform from
     * dist/fast-spider-skills-kit/platforms/<name>/ and applies its
     * fingerprint options, beforeParse hook, and scrape config.
     *
     * Internally calls src/env/core.js prototype builders via
     * buildFakeBrowser → createWindow / buildNavigator / buildDocument.
     *
     * @param {Object} [options]
     * @param {string} [options.platform]          Platform name to auto-load
     * @param {string} [options.platformsDir]      Custom platforms directory
     * @param {string} [options.userAgent]         User-Agent header
     * @param {string} [options.href]              Page URL for location/document
     * @param {number} [options.canvasSeed]        Fingerprint seed (0 = fixed default)
     * @param {boolean} [options.debugAll=false]    Enable document.all access logging
     * @param {Function} [options.beforeParse]      Lifecycle hook (merged with platform hook if both exist)
     * @param {Object} [options.console]            Console override (default: global console)
     * @returns {Object} window suitable for vm.createContext()
     */
    createBrowser(options) {
        const opts = options || {};
        let platform = null;

        // Auto-load platform if specified
        if (opts.platform) {
            platform = loadPlatform(opts.platform, opts.platformsDir);
        }

        // Merge platform fingerprint options
        if (platform) {
            const fp = platform.getFingerprintOptions() || {};
            if (fp.canvasSeed !== undefined && opts.canvasSeed === undefined) {
                opts.canvasSeed = fp.canvasSeed;
            }
            if (fp.webglProfile && fp.webglProfile !== 'random') {
                setGPUProfile(fp.webglProfile);
            }
        }

        // Merge beforeParse hooks (platform hook runs first, then user hook)
        const userBeforeParse = opts.beforeParse;
        if (platform) {
            const platformHook = platform.getBeforeParseHook();
            if (platformHook && userBeforeParse) {
                opts.beforeParse = function (win) {
                    platformHook(win);
                    userBeforeParse(win);
                };
            } else if (platformHook) {
                opts.beforeParse = platformHook;
            }
        }

        const win = buildFakeBrowser(opts);

        // Attach platform reference for lifecycle hooks
        if (platform) {
            win.__platform = platform;
        }

        return win;
    },

    /**
     * Create a fake browser window from a configuration object.
     *
     * @param {Object} config — parsed config (from loadConfig or inline)
     * @param {Object} [overrides] — per-call overrides
     * @returns {Object} window
     *
     * @example
     *   const win = Toolkit.createBrowserFromConfig(
     *     Toolkit.loadConfig('./config/targets/jd.json'),
     *     { browser: { user_agent: '... Chrome/146 ...' } }
     *   );
     */
    createBrowserFromConfig,

    /**
     * Load a JSON configuration file (supports // comments).
     *
     * @param {string} configPath
     * @returns {Object}
     */
    loadConfig,

    // ── Fingerprint ─────────────────────────────────────────────────────────

    /**
     * Fingerprint engine with GPU profile management.
     *
     * @property {Function} createCanvas(seed, width, height)
     * @property {Function} createCanvas2D(seed, canvasWidth, canvasHeight)
     * @property {Function} createWebGLContext(seed, kind)
     * @property {Function} createAudioContext(seed, opts)
     * @property {Function} createRNG(seed)
     * @property {Array}    GPU_POOL — mutable GPU hardware profiles
     * @property {Function} setProfile(name)     — pin pool to one profile
     * @property {Function} listProfiles()       — get available profile names
     * @property {Function} getProfiles()        — inspect full GPU pool
     */
    Fingerprint: Object.assign(
        {
            setProfile: setGPUProfile,
            listProfiles: listGPUProfiles,
            getProfiles: getGPUProfiles,
        },
        fingerprint
    ),

    // ── document.all ────────────────────────────────────────────────────────

    createDocumentAll,

    // ── Platform management ─────────────────────────────────────────────────

    /**
     * Platform namespace — load and manage target-platform implementations.
     *
     * Platforms live under dist/fast-spider-skills-kit/platforms/<name>/.
     * Each platform extends BasePlatform and provides fingerprint options,
     * beforeParse hooks, and scrape configuration for a specific target site.
     *
     * @property {Function} load(name, dir?)   Load a platform by name
     * @property {Function} resolve(name, dir?) Resolve a platform directory
     * @property {Function} createBrowser(options)  Create browser with platform auto-load
     */
    Platform: {
        load: loadPlatform,
        resolve: resolvePlatformDir,
        /** List available platform names under the default directory */
        list(dir) {
            const base = dir || DEFAULT_PLATFORMS_DIR;
            if (!fs.existsSync(base)) return [];
            return fs.readdirSync(base, { withFileTypes: true })
                .filter(d => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'base_platform')
                .map(d => d.name);
        },
    },

    // ── Config ──────────────────────────────────────────────────────────────

    loadConfig,
    createBrowserFromConfig,

    // ── Backward compat ─────────────────────────────────────────────────────

    /** Raw buildFakeBrowser — for code that imports from ./src/env directly. */
    buildFakeBrowser,

    // ── Version ─────────────────────────────────────────────────────────────

    version: '2.2.0',
};

module.exports = Toolkit;
