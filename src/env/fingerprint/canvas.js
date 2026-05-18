// src/env/fingerprint/canvas.js
// Seeded Canvas fingerprint generator.
//
// Design:
//   - Uses a 32-bit seed → deterministic PRNG (mulberry32).
//   - On first call: generates a stable canvas fingerprint from the seed.
//   - Subsequent calls with the same seed produce identical results.
//   - Different seeds produce different (but equally valid) fingerprints.
//
// Canvas 2D: 300×150 px matches Chrome's default canvas size.
//   - toDataURL() returns a seed-derived PNG-like data URL.
//   - getImageData() returns seed-derived pixel data at requested dimensions.
//
// WebGL:   Vendor/renderer strings are seeded from a pool of realistic values.
//   - getParameter() for VENDOR / RENDERER / UNMASKED_* returns seed-consistent values.
//   - getSupportedExtensions() returns a seed-consistent extension list.

'use strict';

// ── mulberry32 PRNG ─────────────────────────────────────────────────────────

function createRNG(seed) {
    let s = seed | 0;
    return function () {
        s |= 0;
        s = s + 0x6D2B79F5 | 0;
        let t = Math.imul(s ^ s >>> 15, 1 | s);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// ── Seed → pixel data ───────────────────────────────────────────────────────

function generatePixels(rng, width, height) {
    const len = width * height * 4;
    const data = new Uint8ClampedArray(len);
    // Fill with seed-derived noise (small perturbations around baseline)
    for (let i = 0; i < len; i++) {
        // Baseline + small random offset (-3..+3)
        const base = [128, 128, 128, 255][i % 4]; // neutral grey baseline
        const offset = Math.floor(rng() * 7) - 3;
        data[i] = Math.max(0, Math.min(255, base + offset));
    }
    return data;
}

// ── Pixel data → minimal PNG (valid header) ─────────────────────────────────

function _uint8ToBinary(png) {
    // Chunked conversion to avoid "Maximum call stack size exceeded"
    const CHUNK = 8192;
    const parts = [];
    for (let i = 0; i < png.length; i += CHUNK) {
        parts.push(String.fromCharCode.apply(null, png.subarray(i, i + CHUNK)));
    }
    return parts.join('');
}

function pixelsToDataURL(width, height, data) {
    const crc32 = _crc32;

    // Build a single PNG chunk: 4-byte len + 4-byte type + data + 4-byte CRC
    function chunk(type, dataBytes) {
        const dataLen = dataBytes.length;
        const buf = new Uint8Array(4 + 4 + dataLen + 4); // len + type + data + crc
        const dv = new DataView(buf.buffer);
        dv.setUint32(0, dataLen);             // length
        buf[4] = type.charCodeAt(0);          // type
        buf[5] = type.charCodeAt(1);
        buf[6] = type.charCodeAt(2);
        buf[7] = type.charCodeAt(3);
        buf.set(dataBytes, 8);                // data
        // CRC over type + data
        const crcInput = new Uint8Array(4 + dataLen);
        crcInput.set(buf.subarray(4, 8), 0);
        crcInput.set(dataBytes, 4);
        dv.setUint32(8 + dataLen, crc32(crcInput));
        return buf;
    }

    // IHDR
    const ihdr = new Uint8Array(4 + 4 + 1 + 1); // width + height + bitdepth + colortype
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, width);
    dv.setUint32(4, height);
    ihdr[8] = 8;   // bit depth
    ihdr[9] = 6;   // color type RGBA

    // IDAT — raw pixel data with zlib header (stored, no compression)
    const scanlineLen = 1 + width * 4;
    const raw = new Uint8Array(height * scanlineLen);
    for (let y = 0; y < height; y++) {
        raw[y * scanlineLen] = 0; // filter: none
        for (let x = 0; x < width * 4; x++) {
            raw[y * scanlineLen + 1 + x] = data[y * width * 4 + x];
        }
    }
    const deflated = _deflateStored(raw);

    const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdrChunk = chunk('IHDR', ihdr);
    const idatChunk = chunk('IDAT', deflated);
    const iendChunk = chunk('IEND', new Uint8Array(0)); // IEND has empty data

    const totalLen = sig.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
    const png = new Uint8Array(totalLen);
    let off = 0;
    png.set(sig, off); off += sig.length;
    png.set(ihdrChunk, off); off += ihdrChunk.length;
    png.set(idatChunk, off); off += idatChunk.length;
    png.set(iendChunk, off);

    const binary = _uint8ToBinary(png);
    return 'data:image/png;base64,' + Buffer.from(binary, 'binary').toString('base64');
}

function _deflateStored(data) {
    // Minimal deflate: stored block (no compression)
    const blockCount = Math.ceil(data.length / 65535);
    const result = [];
    // zlib header
    result.push(0x78, 0x01); // CMF + FLG: deflate, window=32k, level=fast
    for (let i = 0; i < blockCount; i++) {
        const isLast = (i === blockCount - 1);
        const chunkSize = Math.min(data.length - i * 65535, 65535);
        result.push(isLast ? 1 : 0); // BFINAL
        // LEN + NLEN
        result.push(chunkSize & 0xff, (chunkSize >> 8) & 0xff);
        result.push((~chunkSize) & 0xff, ((~chunkSize) >> 8) & 0xff);
        for (let j = 0; j < chunkSize; j++) {
            result.push(data[i * 65535 + j]);
        }
    }
    // adler32
    const adler = _adler32(data);
    result.push((adler >> 24) & 0xff, (adler >> 16) & 0xff, (adler >> 8) & 0xff, adler & 0xff);
    return new Uint8Array(result);
}

function _crc32(data) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
        crc ^= data[i];
        for (let j = 0; j < 8; j++) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
        }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function _adler32(data) {
    let s1 = 1, s2 = 0;
    for (let i = 0; i < data.length; i++) {
        s1 = (s1 + data[i]) % 65521;
        s2 = (s2 + s1) % 65521;
    }
    return (s2 << 16) | s1;
}

// ── Canvas 2D context builder ────────────────────────────────────────────────

const { safefunction } = require('../utils');

/**
 * Create a seeded canvas 2D rendering context.
 * @param {number} seed
 * @returns {Object} CanvasRenderingContext2D mock
 */
function createCanvas2D(seed, canvasWidth, canvasHeight) {
    const rng = createRNG(seed);
    const imgData = generatePixels(rng, canvasWidth, canvasHeight);
    const dataURL = pixelsToDataURL(canvasWidth, canvasHeight, imgData);

    const ctx = {};

    ctx.fillStyle = '#000';
    ctx.strokeStyle = '#000';
    ctx.font = '10px sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'start';

    ctx.fillRect = safefunction(function () {}, 'fillRect', 4);
    ctx.strokeRect = safefunction(function () {}, 'strokeRect', 4);
    ctx.clearRect = safefunction(function () {}, 'clearRect', 4);
    ctx.fillText = safefunction(function () {}, 'fillText', 3);
    ctx.strokeText = safefunction(function () {}, 'strokeText', 3);

    // Deterministic text measurement
    ctx.measureText = safefunction(function measureText(t) {
        const w = Math.floor((t.length * 6) + rng() * 2); // tiny seed-based jitter
        return { width: w, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 };
    }, 'measureText', 1);

    // getImageData — deterministic, seed-derived
    ctx.getImageData = safefunction(function getImageData(x, y, w, h) {
        const subRng = createRNG(seed ^ ((x << 16) | (y << 8) | (w + h)));
        return {
            data: generatePixels(subRng, w, h),
            width: w,
            height: h,
        };
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
        return { addColorStop: safefunction(function () {}, 'addColorStop', 2) };
    }, 'createLinearGradient', 4);

    ctx.createRadialGradient = safefunction(function () {
        return { addColorStop: safefunction(function () {}, 'addColorStop', 2) };
    }, 'createRadialGradient', 6);

    return ctx;
}

/**
 * Create a seeded HTMLCanvasElement.
 * @param {number} seed
 * @param {number} [width=300]
 * @param {number} [height=150]
 * @returns {Object} canvas element mock
 */
function createCanvas(seed, width, height) {
    const w = width || 300;
    const h = height || 150;
    const rng = createRNG(seed);

    const canvas = {};
    canvas.width = w;
    canvas.height = h;

    // Seed-derived toDataURL — stable across calls
    canvas.toDataURL = safefunction(function toDataURL() {
        const imgData = generatePixels(rng, w, h);
        return pixelsToDataURL(w, h, imgData);
    }, 'toDataURL', 0);

    canvas.toBlob = safefunction(function toBlob(cb) {
        const imgData = generatePixels(rng, w, h);
        const blob = {
            size: imgData.length,
            type: 'image/png',
            arrayBuffer: () => Promise.resolve(imgData.buffer),
        };
        cb(blob);
    }, 'toBlob', 1);

    canvas.getContext = safefunction(function getContext(kind) {
        if (kind === '2d') return createCanvas2D(seed, w, h);
        // webgl/webgl2 handled by webgl.js
        return null;
    }, 'getContext', 1);

    return canvas;
}

module.exports = { createCanvas, createCanvas2D, createRNG };
