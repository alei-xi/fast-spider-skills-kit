// src/env/fingerprint/webgl.js
// Seeded WebGL fingerprint stubs.
//
// Provides both WebGLRenderingContext and WebGL2RenderingContext with
// seed-consistent vendor/renderer strings from a realistic hardware pool.
//
// Parameter constants:
//   7936  = VENDOR
//   7937  = RENDERER
//   7938  = VERSION
//   37445 = UNMASKED_VENDOR_WEBGL
//   37446 = UNMASKED_RENDERER_WEBGL
//   33901 = ALIASED_POINT_SIZE_RANGE
//   33902 = ALIASED_LINE_WIDTH_RANGE
//   3414  = MAX_TEXTURE_SIZE
//   3415  = MAX_VIEWPORT_DIMS
//   34076 = MAX_RENDERBUFFER_SIZE
//   3379  = MAX_VIEWS (WebGL2)

'use strict';

const { safefunction } = require('../utils');
const { createRNG } = require('./canvas');

// ── Hardware profiles ───────────────────────────────────────────────────────

const GPU_POOL = [
    {
        vendor: 'Intel Inc.',
        renderer: 'Intel Iris OpenGL Engine',
        version: 'WebGL 1.0 (OpenGL ES 2.0 Chromium)',
        slVersion: 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)',
    },
    {
        vendor: 'NVIDIA Corporation',
        renderer: 'NVIDIA GeForce RTX 3080/PCIe/SSE2',
        version: 'WebGL 1.0 (OpenGL ES 2.0 Chromium)',
        slVersion: 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)',
    },
    {
        vendor: 'Intel Inc.',
        renderer: 'Intel Iris Xe Graphics',
        version: 'WebGL 1.0 (OpenGL ES 2.0 Chromium)',
        slVersion: 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)',
    },
    {
        vendor: 'AMD',
        renderer: 'AMD Radeon Pro 5500M OpenGL Engine',
        version: 'WebGL 1.0 (OpenGL ES 2.0 Chromium)',
        slVersion: 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)',
    },
    {
        vendor: 'Google Inc. (Intel)',
        renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E9B) Direct3D11 vs_5_0 ps_5_0, D3D11)',
        version: 'WebGL 1.0 (OpenGL ES 2.0 Chromium)',
        slVersion: 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)',
    },
];

// Per-profile extension configurations
const EXTENSION_SETS = [
    // Common extensions
    ['ANGLE_instanced_arrays', 'EXT_blend_minmax', 'EXT_color_buffer_half_float', 'EXT_disjoint_timer_query', 'EXT_float_blend', 'EXT_texture_compression_bptc', 'EXT_texture_compression_rgtc', 'EXT_texture_filter_anisotropic', 'EXT_sRGB', 'OES_element_index_uint', 'OES_fbo_render_mipmap', 'OES_standard_derivatives', 'OES_texture_float', 'OES_texture_float_linear', 'OES_texture_half_float', 'OES_texture_half_float_linear', 'OES_vertex_array_object', 'WEBGL_color_buffer_float', 'WEBGL_compressed_texture_s3tc', 'WEBGL_compressed_texture_s3tc_srgb', 'WEBGL_debug_renderer_info', 'WEBGL_debug_shaders', 'WEBGL_depth_texture', 'WEBGL_draw_buffers', 'WEBGL_lose_context', 'WEBGL_multi_draw'],
    // Slightly different set
    ['ANGLE_instanced_arrays', 'EXT_blend_minmax', 'EXT_color_buffer_half_float', 'EXT_disjoint_timer_query', 'EXT_texture_filter_anisotropic', 'EXT_sRGB', 'OES_element_index_uint', 'OES_standard_derivatives', 'OES_texture_float', 'OES_texture_float_linear', 'OES_texture_half_float', 'OES_texture_half_float_linear', 'OES_vertex_array_object', 'WEBGL_color_buffer_float', 'WEBGL_compressed_texture_s3tc', 'WEBGL_compressed_texture_s3tc_srgb', 'WEBGL_debug_renderer_info', 'WEBGL_debug_shaders', 'WEBGL_depth_texture', 'WEBGL_draw_buffers', 'WEBGL_lose_context', 'WEBGL_multi_draw'],
];

// ── WebGL constant map ───────────────────────────────────────────────────────

function buildParamMap(rng, profile) {
    const maxTexSize = [2048, 4096, 8192, 16384][Math.floor(rng() * 4)];
    return {
        7936: profile.vendor,            // VENDOR
        7937: profile.renderer,          // RENDERER
        7938: profile.version,           // VERSION
        35724: profile.slVersion,        // SHADING_LANGUAGE_VERSION
        37445: profile.vendor,           // UNMASKED_VENDOR_WEBGL
        37446: profile.renderer,         // UNMASKED_RENDERER_WEBGL
        33901: new Float32Array([1, 1024]), // ALIASED_POINT_SIZE_RANGE
        33902: new Float32Array([1, 1024]), // ALIASED_LINE_WIDTH_RANGE
        3414: maxTexSize,                // MAX_TEXTURE_SIZE
        3415: new Int32Array([maxTexSize, maxTexSize]), // MAX_VIEWPORT_DIMS
        34076: maxTexSize,               // MAX_RENDERBUFFER_SIZE
        34024: 16,                       // MAX_COMBINED_TEXTURE_IMAGE_UNITS
        35661: 16,                       // MAX_VERTEX_TEXTURE_IMAGE_UNITS
        35660: 32,                       // MAX_TEXTURE_IMAGE_UNITS
        3379: maxTexSize,                // MAX_VIEWS (WebGL2)
        3386: new Int32Array([maxTexSize, maxTexSize]), // MAX_3D_TEXTURE_SIZE (WebGL2)
        34930: 8,                        // MAX_DRAW_BUFFERS (WebGL2)
        35658: 0,                        // MAX_VERTEX_UNIFORM_VECTORS
        35659: 0,                        // MAX_VARYING_VECTORS
        35657: 0,                        // MAX_FRAGMENT_UNIFORM_VECTORS
    };
}

// ── Builder ──────────────────────────────────────────────────────────────────

/**
 * Create a seeded WebGL rendering context.
 *
 * @param {number} seed  Deterministic seed
 * @param {'webgl'|'webgl2'} kind
 * @returns {Object} WebGL context mock
 */
function createWebGLContext(seed, kind) {
    const rng = createRNG(seed);
    const profileIndex = Math.floor(rng() * GPU_POOL.length);
    const profile = GPU_POOL[profileIndex];
    const extIndex = Math.floor(rng() * EXTENSION_SETS.length);
    const extensions = EXTENSION_SETS[extIndex];
    const paramMap = buildParamMap(rng, profile);

    const ctx = {};

    ctx.getParameter = safefunction(function getParameter(pname) {
        if (pname in paramMap) return paramMap[pname];
        return null;
    }, 'getParameter', 1);

    ctx.getExtension = safefunction(function getExtension(name) {
        return extensions.includes(name) ? {} : null;
    }, 'getExtension', 1);

    ctx.getSupportedExtensions = safefunction(function getSupportedExtensions() {
        return extensions.slice();
    }, 'getSupportedExtensions', 0);

    ctx.getShaderPrecisionFormat = safefunction(function getShaderPrecisionFormat(shaderType, precisionType) {
        return {
            rangeMin: 127, rangeMax: 127, precision: 23,
        };
    }, 'getShaderPrecisionFormat', 2);

    ctx.getContextAttributes = safefunction(function getContextAttributes() {
        return {
            alpha: true, antialias: true, depth: true,
            failIfMajorPerformanceCaveat: false,
            powerPreference: 'default',
            premultipliedAlpha: true,
            preserveDrawingBuffer: false,
            stencil: false,
            desynchronized: false,
            xrCompatible: false,
        };
    }, 'getContextAttributes', 0);

    // Drawing methods (no-op)
    ctx.activeTexture = safefunction(function () {}, 'activeTexture', 1);
    ctx.attachShader = safefunction(function () {}, 'attachShader', 2);
    ctx.bindAttribLocation = safefunction(function () {}, 'bindAttribLocation', 3);
    ctx.bindBuffer = safefunction(function () {}, 'bindBuffer', 2);
    ctx.bindFramebuffer = safefunction(function () {}, 'bindFramebuffer', 2);
    ctx.bindRenderbuffer = safefunction(function () {}, 'bindRenderbuffer', 2);
    ctx.bindTexture = safefunction(function () {}, 'bindTexture', 2);
    ctx.blendColor = safefunction(function () {}, 'blendColor', 4);
    ctx.blendEquation = safefunction(function () {}, 'blendEquation', 1);
    ctx.blendEquationSeparate = safefunction(function () {}, 'blendEquationSeparate', 2);
    ctx.blendFunc = safefunction(function () {}, 'blendFunc', 2);
    ctx.blendFuncSeparate = safefunction(function () {}, 'blendFuncSeparate', 4);
    ctx.bufferData = safefunction(function () {}, 'bufferData', 3);
    ctx.bufferSubData = safefunction(function () {}, 'bufferSubData', 3);
    ctx.checkFramebufferStatus = safefunction(function () { return 36053; }, 'checkFramebufferStatus', 1); // FRAMEBUFFER_COMPLETE
    ctx.clear = safefunction(function () {}, 'clear', 1);
    ctx.clearColor = safefunction(function () {}, 'clearColor', 4);
    ctx.clearDepth = safefunction(function () {}, 'clearDepth', 1);
    ctx.clearStencil = safefunction(function () {}, 'clearStencil', 1);
    ctx.colorMask = safefunction(function () {}, 'colorMask', 4);
    ctx.compileShader = safefunction(function () {}, 'compileShader', 1);
    ctx.compressedTexImage2D = safefunction(function () {}, 'compressedTexImage2D', 7);
    ctx.compressedTexSubImage2D = safefunction(function () {}, 'compressedTexSubImage2D', 8);
    ctx.copyTexImage2D = safefunction(function () {}, 'copyTexImage2D', 8);
    ctx.copyTexSubImage2D = safefunction(function () {}, 'copyTexSubImage2D', 8);
    ctx.createBuffer = safefunction(function () { return {}; }, 'createBuffer', 0);
    ctx.createFramebuffer = safefunction(function () { return {}; }, 'createFramebuffer', 0);
    ctx.createProgram = safefunction(function () { return {}; }, 'createProgram', 0);
    ctx.createRenderbuffer = safefunction(function () { return {}; }, 'createRenderbuffer', 0);
    ctx.createShader = safefunction(function () { return {}; }, 'createShader', 1);
    ctx.createTexture = safefunction(function () { return {}; }, 'createTexture', 0);
    ctx.cullFace = safefunction(function () {}, 'cullFace', 1);
    ctx.deleteBuffer = safefunction(function () {}, 'deleteBuffer', 1);
    ctx.deleteFramebuffer = safefunction(function () {}, 'deleteFramebuffer', 1);
    ctx.deleteProgram = safefunction(function () {}, 'deleteProgram', 1);
    ctx.deleteRenderbuffer = safefunction(function () {}, 'deleteRenderbuffer', 1);
    ctx.deleteShader = safefunction(function () {}, 'deleteShader', 1);
    ctx.deleteTexture = safefunction(function () {}, 'deleteTexture', 1);
    ctx.depthFunc = safefunction(function () {}, 'depthFunc', 1);
    ctx.depthMask = safefunction(function () {}, 'depthMask', 1);
    ctx.depthRange = safefunction(function () {}, 'depthRange', 2);
    ctx.detachShader = safefunction(function () {}, 'detachShader', 2);
    ctx.disable = safefunction(function () {}, 'disable', 1);
    ctx.disableVertexAttribArray = safefunction(function () {}, 'disableVertexAttribArray', 1);
    ctx.drawArrays = safefunction(function () {}, 'drawArrays', 3);
    ctx.drawElements = safefunction(function () {}, 'drawElements', 4);
    ctx.enable = safefunction(function () {}, 'enable', 1);
    ctx.enableVertexAttribArray = safefunction(function () {}, 'enableVertexAttribArray', 1);
    ctx.finish = safefunction(function () {}, 'finish', 0);
    ctx.flush = safefunction(function () {}, 'flush', 0);
    ctx.framebufferRenderbuffer = safefunction(function () {}, 'framebufferRenderbuffer', 4);
    ctx.framebufferTexture2D = safefunction(function () {}, 'framebufferTexture2D', 5);
    ctx.frontFace = safefunction(function () {}, 'frontFace', 1);
    ctx.generateMipmap = safefunction(function () {}, 'generateMipmap', 1);
    ctx.getActiveAttrib = safefunction(function () { return null; }, 'getActiveAttrib', 2);
    ctx.getActiveUniform = safefunction(function () { return null; }, 'getActiveUniform', 2);
    ctx.getAttachedShaders = safefunction(function () { return []; }, 'getAttachedShaders', 1);
    ctx.getAttribLocation = safefunction(function () { return -1; }, 'getAttribLocation', 2);
    ctx.getBufferParameter = safefunction(function () { return null; }, 'getBufferParameter', 2);
    ctx.getError = safefunction(function () { return 0; }, 'getError', 0); // NO_ERROR
    ctx.getFramebufferAttachmentParameter = safefunction(function () { return null; }, 'getFramebufferAttachmentParameter', 3);
    ctx.getProgramInfoLog = safefunction(function () { return ''; }, 'getProgramInfoLog', 1);
    ctx.getProgramParameter = safefunction(function () { return true; }, 'getProgramParameter', 2);
    ctx.getRenderbufferParameter = safefunction(function () { return null; }, 'getRenderbufferParameter', 2);
    ctx.getShaderInfoLog = safefunction(function () { return ''; }, 'getShaderInfoLog', 1);
    ctx.getShaderParameter = safefunction(function () { return true; }, 'getShaderParameter', 2);
    ctx.getShaderSource = safefunction(function () { return ''; }, 'getShaderSource', 1);
    ctx.getTexParameter = safefunction(function () { return null; }, 'getTexParameter', 2);
    ctx.getUniform = safefunction(function () { return null; }, 'getUniform', 2);
    ctx.getUniformLocation = safefunction(function () { return null; }, 'getUniformLocation', 2);
    ctx.getVertexAttrib = safefunction(function () { return null; }, 'getVertexAttrib', 2);
    ctx.getVertexAttribOffset = safefunction(function () { return 0; }, 'getVertexAttribOffset', 2);
    ctx.hint = safefunction(function () {}, 'hint', 2);
    ctx.isBuffer = safefunction(function () { return false; }, 'isBuffer', 1);
    ctx.isContextLost = safefunction(function () { return false; }, 'isContextLost', 0);
    ctx.isEnabled = safefunction(function () { return false; }, 'isEnabled', 1);
    ctx.isFramebuffer = safefunction(function () { return false; }, 'isFramebuffer', 1);
    ctx.isProgram = safefunction(function () { return false; }, 'isProgram', 1);
    ctx.isRenderbuffer = safefunction(function () { return false; }, 'isRenderbuffer', 1);
    ctx.isShader = safefunction(function () { return false; }, 'isShader', 1);
    ctx.isTexture = safefunction(function () { return false; }, 'isTexture', 1);
    ctx.lineWidth = safefunction(function () {}, 'lineWidth', 1);
    ctx.linkProgram = safefunction(function () {}, 'linkProgram', 1);
    ctx.pixelStorei = safefunction(function () {}, 'pixelStorei', 2);
    ctx.polygonOffset = safefunction(function () {}, 'polygonOffset', 2);
    ctx.readPixels = safefunction(function () {
        return new Uint8Array(4);
    }, 'readPixels', 7);
    ctx.renderbufferStorage = safefunction(function () {}, 'renderbufferStorage', 4);
    ctx.sampleCoverage = safefunction(function () {}, 'sampleCoverage', 2);
    ctx.scissor = safefunction(function () {}, 'scissor', 4);
    ctx.shaderSource = safefunction(function () {}, 'shaderSource', 2);
    ctx.stencilFunc = safefunction(function () {}, 'stencilFunc', 3);
    ctx.stencilFuncSeparate = safefunction(function () {}, 'stencilFuncSeparate', 4);
    ctx.stencilMask = safefunction(function () {}, 'stencilMask', 1);
    ctx.stencilMaskSeparate = safefunction(function () {}, 'stencilMaskSeparate', 2);
    ctx.stencilOp = safefunction(function () {}, 'stencilOp', 3);
    ctx.stencilOpSeparate = safefunction(function () {}, 'stencilOpSeparate', 4);
    ctx.texImage2D = safefunction(function () {}, 'texImage2D', 9);
    ctx.texParameterf = safefunction(function () {}, 'texParameterf', 3);
    ctx.texParameteri = safefunction(function () {}, 'texParameteri', 3);
    ctx.texSubImage2D = safefunction(function () {}, 'texSubImage2D', 9);
    ctx.uniform1f = safefunction(function () {}, 'uniform1f', 2);
    ctx.uniform1fv = safefunction(function () {}, 'uniform1fv', 2);
    ctx.uniform1i = safefunction(function () {}, 'uniform1i', 2);
    ctx.uniform1iv = safefunction(function () {}, 'uniform1iv', 2);
    ctx.uniform2f = safefunction(function () {}, 'uniform2f', 3);
    ctx.uniform2fv = safefunction(function () {}, 'uniform2fv', 2);
    ctx.uniform2i = safefunction(function () {}, 'uniform2i', 3);
    ctx.uniform2iv = safefunction(function () {}, 'uniform2iv', 2);
    ctx.uniform3f = safefunction(function () {}, 'uniform3f', 4);
    ctx.uniform3fv = safefunction(function () {}, 'uniform3fv', 2);
    ctx.uniform3i = safefunction(function () {}, 'uniform3i', 4);
    ctx.uniform3iv = safefunction(function () {}, 'uniform3iv', 2);
    ctx.uniform4f = safefunction(function () {}, 'uniform4f', 5);
    ctx.uniform4fv = safefunction(function () {}, 'uniform4fv', 2);
    ctx.uniform4i = safefunction(function () {}, 'uniform4i', 5);
    ctx.uniform4iv = safefunction(function () {}, 'uniform4iv', 2);
    ctx.uniformMatrix2fv = safefunction(function () {}, 'uniformMatrix2fv', 3);
    ctx.uniformMatrix3fv = safefunction(function () {}, 'uniformMatrix3fv', 3);
    ctx.uniformMatrix4fv = safefunction(function () {}, 'uniformMatrix4fv', 3);
    ctx.useProgram = safefunction(function () {}, 'useProgram', 1);
    ctx.validateProgram = safefunction(function () {}, 'validateProgram', 1);
    ctx.vertexAttrib1f = safefunction(function () {}, 'vertexAttrib1f', 2);
    ctx.vertexAttrib1fv = safefunction(function () {}, 'vertexAttrib1fv', 2);
    ctx.vertexAttrib2f = safefunction(function () {}, 'vertexAttrib2f', 3);
    ctx.vertexAttrib2fv = safefunction(function () {}, 'vertexAttrib2fv', 2);
    ctx.vertexAttrib3f = safefunction(function () {}, 'vertexAttrib3f', 4);
    ctx.vertexAttrib3fv = safefunction(function () {}, 'vertexAttrib3fv', 2);
    ctx.vertexAttrib4f = safefunction(function () {}, 'vertexAttrib4f', 5);
    ctx.vertexAttrib4fv = safefunction(function () {}, 'vertexAttrib4fv', 2);
    ctx.vertexAttribPointer = safefunction(function () {}, 'vertexAttribPointer', 6);
    ctx.viewport = safefunction(function () {}, 'viewport', 4);

    return ctx;
}

module.exports = { createWebGLContext, GPU_POOL };
