// src/env/fingerprint/audio.js
// Seeded AudioContext fingerprint stubs.
//
// Audio fingerprinting typically works by:
//   1. Creating an OscillatorNode → connecting to DynamicsCompressorNode → destination
//   2. Reading AnalyserNode.getFloatTimeDomainData / getByteFrequencyData
//   3. Comparing subtle differences caused by hardware rounding
//
// This stub returns seed-consistent values with micro-variation to mimic
// real audio hardware. The AnalyserNode returns deterministic-but-noisy data
// that looks like legitimate audio samples.

'use strict';

const { safefunction } = require('../utils');
const { createRNG } = require('./canvas');

// ── AudioContext ─────────────────────────────────────────────────────────────

/**
 * Create a seeded AudioContext.
 *
 * @param {number} seed
 * @param {Object} [opts]
 * @param {number} [opts.sampleRate=44100]
 * @returns {Object} AudioContext mock
 */
function createAudioContext(seed, opts) {
    const rng = createRNG(seed);
    const sampleRate = (opts && opts.sampleRate) || 44100;
    const _state = 'running';

    const ctx = {};

    ctx.sampleRate = sampleRate;
    ctx.state = _state;
    ctx.destination = {
        maxChannelCount: 2,
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
    };
    ctx.baseLatency = 0.005 + rng() * 0.003; // 5-8ms typical

    ctx.currentTime = 0; // will be updated by caller if needed

    // Methods
    ctx.createOscillator = safefunction(function createOscillator() {
        return {
            type: 'sine',
            frequency: { value: 440 + (rng() - 0.5) * 0.002 }, // ~440Hz with micro-variation
            detune: { value: 0 },
            connect: safefunction(function () {}, 'connect', 1),
            disconnect: safefunction(function () {}, 'disconnect', 0),
            start: safefunction(function () {}, 'start', 1),
            stop: safefunction(function () {}, 'stop', 1),
            addEventListener: safefunction(function () {}, 'addEventListener', 2),
        };
    }, 'createOscillator', 0);

    ctx.createDynamicsCompressor = safefunction(function createDynamicsCompressor() {
        return {
            threshold: { value: -50 + (rng() - 0.5) * 0.1 },
            knee: { value: 40 + (rng() - 0.5) * 0.1 },
            ratio: { value: 12 + (rng() - 0.5) * 0.01 },
            reduction: { value: -20 + (rng() - 0.5) * 0.1 },
            attack: { value: 0.003 + rng() * 0.001 },
            release: { value: 0.25 + rng() * 0.001 },
            connect: safefunction(function () {}, 'connect', 1),
            disconnect: safefunction(function () {}, 'disconnect', 0),
        };
    }, 'createDynamicsCompressor', 0);

    ctx.createAnalyser = safefunction(function createAnalyser() {
        const fftSize = 2048;
        const freqBinCount = fftSize / 2;
        const _cachedFreqData = _genFreqData(seed, freqBinCount);
        const _cachedTimeData = _genTimeData(seed, fftSize);

        return {
            fftSize,
            frequencyBinCount: freqBinCount,
            minDecibels: -100,
            maxDecibels: -30,
            smoothingTimeConstant: 0.8,

            getFloatFrequencyData: safefunction(function getFloatFrequencyData(array) {
                if (array) array.set(_cachedFreqData.slice(0, array.length));
            }, 'getFloatFrequencyData', 1),

            getByteFrequencyData: safefunction(function getByteFrequencyData(array) {
                if (array) {
                    for (let i = 0; i < array.length && i < _cachedFreqData.length; i++) {
                        // Convert float dB to byte: clamp and scale
                        const dB = _cachedFreqData[i];
                        const val = Math.max(0, Math.min(255, Math.round((dB + 100) * 2.55)));
                        array[i] = val;
                    }
                }
            }, 'getByteFrequencyData', 1),

            getFloatTimeDomainData: safefunction(function getFloatTimeDomainData(array) {
                if (array) array.set(_cachedTimeData.slice(0, array.length));
            }, 'getFloatTimeDomainData', 1),

            getByteTimeDomainData: safefunction(function getByteTimeDomainData(array) {
                if (array) {
                    for (let i = 0; i < array.length && i < _cachedTimeData.length; i++) {
                        const val = Math.max(0, Math.min(255, Math.round((_cachedTimeData[i] + 1) * 128)));
                        array[i] = val;
                    }
                }
            }, 'getByteTimeDomainData', 1),

            connect: safefunction(function () {}, 'connect', 1),
            disconnect: safefunction(function () {}, 'disconnect', 0),
        };
    }, 'createAnalyser', 0);

    ctx.createGain = safefunction(function createGain() {
        return {
            gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} },
            connect: safefunction(function () {}, 'connect', 1),
            disconnect: safefunction(function () {}, 'disconnect', 0),
        };
    }, 'createGain', 0);

    ctx.createBiquadFilter = safefunction(function createBiquadFilter() {
        return {
            type: 'lowpass',
            frequency: { value: 350 + rng() * 50 },
            Q: { value: 1 },
            gain: { value: 0 },
            connect: safefunction(function () {}, 'connect', 1),
            disconnect: safefunction(function () {}, 'disconnect', 0),
        };
    }, 'createBiquadFilter', 0);

    ctx.createBuffer = safefunction(function createBuffer(channels, length, sr) {
        return {
            numberOfChannels: channels,
            length,
            sampleRate: sr,
            duration: length / sr,
            getChannelData: safefunction(function getChannelData(ch) {
                const localRng = createRNG(seed ^ ch);
                const data = new Float32Array(length);
                for (let i = 0; i < length; i++) {
                    data[i] = (localRng() - 0.5) * 0.001; // near-silent noise
                }
                return data;
            }, 'getChannelData', 1),
        };
    }, 'createBuffer', 3);

    ctx.createBufferSource = safefunction(function createBufferSource() {
        return {
            buffer: null,
            playbackRate: { value: 1 },
            loop: false,
            connect: safefunction(function () {}, 'connect', 1),
            disconnect: safefunction(function () {}, 'disconnect', 0),
            start: safefunction(function () {}, 'start', 1),
            stop: safefunction(function () {}, 'stop', 1),
            addEventListener: safefunction(function () {}, 'addEventListener', 2),
        };
    }, 'createBufferSource', 0);

    ctx.close = safefunction(function close() {
        return Promise.resolve();
    }, 'close', 0);

    ctx.resume = safefunction(function resume() {
        return Promise.resolve();
    }, 'resume', 0);

    ctx.suspend = safefunction(function suspend() {
        return Promise.resolve();
    }, 'suspend', 0);

    ctx.addEventListener = safefunction(function () {}, 'addEventListener', 2);
    ctx.removeEventListener = safefunction(function () {}, 'removeEventListener', 2);
    ctx.dispatchEvent = safefunction(function () { return true; }, 'dispatchEvent', 1);

    return ctx;
}

// ── Deterministic "audio-like" data generators ──────────────────────────────

function _genFreqData(seed, length) {
    const rng = createRNG(seed);
    const data = new Float32Array(length);
    // Base curve: gentle roll-off, plus seed-deterministic noise
    for (let i = 0; i < length; i++) {
        const base = -60 - (i / length) * 40; // -60dB at 0Hz, -100dB at Nyquist
        const noise = (rng() - 0.5) * 2;      // ±1dB micro-variation
        data[i] = base + noise;
    }
    return data;
}

function _genTimeData(seed, length) {
    const rng = createRNG(seed);
    const data = new Float32Array(length);
    // Approximate waveform: low-amplitude noise
    for (let i = 0; i < length; i++) {
        data[i] = (rng() - 0.5) * 0.02; // ±1% amplitude
    }
    return data;
}

module.exports = { createAudioContext };
