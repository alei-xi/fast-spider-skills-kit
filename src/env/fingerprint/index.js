// src/env/fingerprint/index.js
// Fingerprint engine — seed-consistent browser fingerprint generators.
//
// All generators accept a numeric seed and produce deterministic output.
// Same seed → identical fingerprint. Different seed → different but valid.
//
// Usage:
//   const { createCanvas, createWebGLContext, createAudioContext } = require('./fingerprint');
//   const canvas = createCanvas(12345);
//   canvas.toDataURL();  // seed-consistent PNG data URL

'use strict';

const { createCanvas, createCanvas2D, createRNG } = require('./canvas');
const { createWebGLContext, GPU_POOL } = require('./webgl');
const { createAudioContext } = require('./audio');

module.exports = {
    createCanvas,
    createCanvas2D,
    createWebGLContext,
    createAudioContext,
    createRNG,
    GPU_POOL,  // mutable — push/remove hardware profiles
};
