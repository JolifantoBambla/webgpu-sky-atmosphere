/*
 * Copyright (c) 2024 Lukas Herzberger
 * SPDX-License-Identifier: MIT
 */

import aerialPerspectiveWgsl from './shaders/common/aerial_perspective.wgsl';
import blendWgsl from './shaders/common/blend.wgsl';
import constantsWgsl from './shaders/common/constants.wgsl';
import customUniformsWgsl from './shaders/common/custom_uniforms.wgsl';
import coordinateSystemWgsl from './shaders/common/coordinate_system.wgsl';
import fullScreenVertexShaderWgsl from './shaders/common/vertex_full_screen.wgsl';
import intersectionWgsl from './shaders/common/intersection.wgsl';
import mediumWgsl from './shaders/common/medium.wgsl';
import multipleScatteringWgsl from './shaders/common/multiple_scattering.wgsl';
import phaseWgsl from './shaders/common/phase.wgsl';
import sampleSegmentWgsl from './shaders/common/sample_sagment_t.wgsl';
import skyViewWgsl from './shaders/common/sky_view.wgsl';
import sunDiskWgsl from './shaders/common/sun_disk.wgsl';
import uniformsWgsl from './shaders/common/uniforms.wgsl';
import uvWgsl from './shaders/common/uv.wgsl';

import renderTransmittanceLutWgsl from './shaders/render_transmittance_lut.wgsl';
import renderMultiScatteringLutWgsl from './shaders/render_multi_scattering_lut.wgsl';
import renderSkyViewLutWgsl from './shaders/render_sky_view_lut.wgsl';
import renderAerialPerspectiveWgsl from './shaders/render_aerial_perspective_lut.wgsl';

import renderSkyWithLutsWgsl from './shaders/render_sky_with_luts.wgsl';
import renderSkyRaymarchingWgsl from './shaders/render_sky_raymarching.wgsl';
import renderSkyLutAndRaymarchingWgsl from './shaders/render_sky_luts_and_raymarch.wgsl';

export function makeTransmittanceLutShaderCode(transmittanceLutFormat: GPUTextureFormat = 'rgba16float') {
    return `${constantsWgsl}\n${intersectionWgsl}\n${mediumWgsl}\n${renderTransmittanceLutWgsl}`.replace('rgba16float', transmittanceLutFormat);
}

export function makeMultiScatteringLutShaderCode(multiScatteringLutFormat: GPUTextureFormat = 'rgba16float') {
    return `${constantsWgsl}\n${intersectionWgsl}\n${mediumWgsl}\n${phaseWgsl}\n${uvWgsl}\n${renderMultiScatteringLutWgsl}`.replace('rgba16float', multiScatteringLutFormat);
}

export function makeSkyViewLutShaderCode(skyViewLutFormat: GPUTextureFormat = 'rgba16float', customUniforms?: string) {
    const base = `${constantsWgsl}\n${intersectionWgsl}\n${mediumWgsl}\n${phaseWgsl}\n${uvWgsl}\n${uniformsWgsl}\n${customUniforms ? `${customUniforms}\n${customUniformsWgsl}\n` : ''}${coordinateSystemWgsl}\n${multipleScatteringWgsl}\n${fullScreenVertexShaderWgsl}\n`;
    let shader = renderSkyViewLutWgsl.replace('rgba16float', skyViewLutFormat);
    if (customUniforms) {
        shader = shader.replace('let config = config_buffer', 'let config = get_uniforms()');
        shader = shader.replace('@group(0) @binding(1) var<uniform> config_buffer: Uniforms;', '');
        for (let i = 2; i < 6; ++i) {
            shader = shader.replace(`group(0) @binding(${i})`, `group(0) @binding(${i - 1})`);
        }
    }
    return `${base}\n${shader}`;
}

export function makeAerialPerspectiveLutShaderCode(aerialPerspectiveLutFormat: GPUTextureFormat = 'rgba16float', customUniforms?: string) {
    const base = `${constantsWgsl}\n${intersectionWgsl}\n${mediumWgsl}\n${phaseWgsl}\n${uvWgsl}\n${uniformsWgsl}\n${customUniforms ? `${customUniforms}\n${customUniformsWgsl}\n` : ''}${coordinateSystemWgsl}\n${multipleScatteringWgsl}\n${aerialPerspectiveWgsl}\n${sampleSegmentWgsl}\n`;
    let shader = renderAerialPerspectiveWgsl.replace('rgba16float', aerialPerspectiveLutFormat);
    if (customUniforms) {
        shader = shader.replace('let config = config_buffer', 'let config = get_uniforms()');
        shader = shader.replace('@group(0) @binding(1) var<uniform> config_buffer: Uniforms;', '');
        for (let i = 2; i < 6; ++i) {
            shader = shader.replace(`group(0) @binding(${i})`, `group(0) @binding(${i - 1})`);
        }
    }
    return `${base}\n${shader}`;
}

export function makeRenderSkyWithLutsShaderCode(renderTargetFormat: GPUTextureFormat = 'rgba16float', customUniforms?: string) {
    const base = `${constantsWgsl}\n${intersectionWgsl}\n${mediumWgsl}\n${phaseWgsl}\n${uvWgsl}\n${uniformsWgsl}\n${customUniforms ? `${customUniforms}\n${customUniformsWgsl}\n` : ''}${coordinateSystemWgsl}\n${aerialPerspectiveWgsl}\n${skyViewWgsl}\n${blendWgsl}\n${sunDiskWgsl}\n${fullScreenVertexShaderWgsl}\n${sampleSegmentWgsl}\n`;
    let shader = renderSkyWithLutsWgsl.replace('rgba16float', renderTargetFormat);
    if (customUniforms) {
        shader = shader.replace('let config = config_buffer', 'let config = get_uniforms()');
        shader = shader.replace('@group(0) @binding(1) var<uniform> config_buffer: Uniforms;', '');
        for (let i = 2; i < 9; ++i) {
            shader = shader.replace(`group(0) @binding(${i})`, `group(0) @binding(${i - 1})`);
        }
    }
    return `${base}\n${shader}`;
}

export function makeRenderSkyRaymarchingShaderCode(renderTargetFormat: GPUTextureFormat = 'rgba16float', customUniforms?: string) {
    const base = `${constantsWgsl}\n${intersectionWgsl}\n${mediumWgsl}\n${phaseWgsl}\n${uvWgsl}\n${uniformsWgsl}\n${customUniforms ? `${customUniforms}\n${customUniformsWgsl}\n` : ''}${coordinateSystemWgsl}\n${multipleScatteringWgsl}\n${blendWgsl}\n${sunDiskWgsl}\n${fullScreenVertexShaderWgsl}\n${sampleSegmentWgsl}\n`;
    let shader = renderSkyRaymarchingWgsl.replace('rgba16float', renderTargetFormat);
    if (customUniforms) {
        shader = shader.replace('let config = config_buffer', 'let config = get_uniforms()');
        shader = shader.replace('@group(0) @binding(1) var<uniform> config_buffer: Uniforms;', '');
        for (let i = 2; i < 9; ++i) {
            shader = shader.replace(`group(0) @binding(${i})`, `group(0) @binding(${i - 1})`);
        }
    }
    return `${base}\n${shader}`;
}

export function makeRenderSkyLutAndRaymarchingShaderCode(renderTargetFormat: GPUTextureFormat = 'rgba16float', customUniforms?: string) {
    const base = `${constantsWgsl}\n${intersectionWgsl}\n${mediumWgsl}\n${phaseWgsl}\n${uvWgsl}\n${uniformsWgsl}\n${customUniforms ? `${customUniforms}\n${customUniformsWgsl}\n` : ''}${coordinateSystemWgsl}\n${multipleScatteringWgsl}\n${skyViewWgsl}\n${blendWgsl}\n${sunDiskWgsl}\n${fullScreenVertexShaderWgsl}\n${sampleSegmentWgsl}\n`;
    let shader = renderSkyLutAndRaymarchingWgsl.replace('rgba16float', renderTargetFormat);
    if (customUniforms) {
        shader = shader.replace('let config = config_buffer', 'let config = get_uniforms()');
        shader = shader.replace('@group(0) @binding(1) var<uniform> config_buffer: Uniforms;', '');
        for (let i = 2; i < 9; ++i) {
            shader = shader.replace(`group(0) @binding(${i})`, `group(0) @binding(${i - 1})`);
        }
    }
    return `${base}\n${shader}`;
}