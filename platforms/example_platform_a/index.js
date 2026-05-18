// platforms/example_platform_a/index.js
// Reference implementation — copy this directory to create a new platform.

'use strict';
const { BasePlatform } = require('../base_platform');

class ExamplePlatformA extends BasePlatform {
    getFingerprintOptions() {
        const fp = this.config.fingerprint || {};
        return {
            canvasSeed: fp.canvas_seed || 0,
            webglProfile: fp.webgl_profile || 'intel_integrated',
        };
    }

    getBeforeParseHook() {
        const script = this.config.before_parse_script || '';
        if (!script) return null;
        const self = this;
        return function (win) {
            try { (new Function('win', script))(win); } catch (e) {
                win.console.error(`[${self.name}] beforeParse error:`, e.message);
            }
        };
    }

    getScrapeConfig() {
        const s = this.config.scrape || {};
        return { headers: s.headers || {}, proxy: s.proxy || null, timeout: s.timeout_ms || 30000 };
    }
}

ExamplePlatformA.load = function (dir) {
    return new ExamplePlatformA(BasePlatform.loadConfig(dir));
};
module.exports = ExamplePlatformA;
