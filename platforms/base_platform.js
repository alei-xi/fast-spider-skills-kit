// platforms/base_platform.js
// Abstract base class for all target-platform implementations.
//
// Every platform under platforms/<name>/index.js MUST implement:
//   getFingerprintOptions() → { canvasSeed?, webglProfile?, ... }
//   getBeforeParseHook()    → function(win) | null
//   getScrapeConfig()       → { headers?, cookies?, proxy?, ... }

'use strict';

class BasePlatform {
    constructor(config) {
        this.config = config || {};
        this.name = this.config.name || this.constructor.name;
    }

    getFingerprintOptions() {
        throw new Error(`${this.name}: getFingerprintOptions() not implemented`);
    }

    getBeforeParseHook() {
        throw new Error(`${this.name}: getBeforeParseHook() not implemented`);
    }

    getScrapeConfig() {
        throw new Error(`${this.name}: getScrapeConfig() not implemented`);
    }

    onSDKLoaded(ctx) {}
    onBeforeSign(url) {}
    onAfterSign(result) {}
    validate(response) { return response && response.status === 200; }

    static loadConfig(platformDir) {
        const fs = require('fs');
        const path = require('path');
        const configPath = path.join(platformDir, 'config.json');
        if (!fs.existsSync(configPath)) return {};
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
}

module.exports = { BasePlatform };
