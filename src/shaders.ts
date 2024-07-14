import aerialPerspectiveWgsl from './shaders/common/aerial_perspective.wgsl';
import blendWgsl from './shaders/common/blend.wgsl';
import configWgsl from './shaders/common/config.wgsl';
import constantsWgsl from './shaders/common/constants.wgsl';
import coordinateSystemWgsl from './shaders/common/coordinate_system.wgsl';
import fullScreenVertexShaderWgsl from './shaders/common/vertex_full_screen.wgsl';
import intersectionWgsl from './shaders/common/intersection.wgsl';
import mediumWgsl from './shaders/common/medium.wgsl';
import multipleScatteringWgsl from './shaders/common/multiple_scattering.wgsl';
import phaseWgsl from './shaders/common/phase.wgsl';
import skyViewWgsl from './shaders/common/sky_view.wgsl';
import sunDiskWgsl from './shaders/common/sun_disk.wgsl';
import uvWgsl from './shaders/common/uv.wgsl';

import renderTransmittanceLutWgsl from './shaders/render_transmittance_lut.wgsl';
import renderMultiScatteringLutWgsl from './shaders/render_multi_scattering_lut.wgsl';
import renderSkyViewLutWgsl from './shaders/render_sky_view_lut.wgsl';
import renderAerialPerspectiveWgsl from './shaders/render_aerial_perspective_lut.wgsl';

import renderSkyWithLutsWgsl from './shaders/render_sky_with_luts.wgsl';
import renderSkyRaymarchingWgsl from './shaders/render_sky_raymarching.wgsl';

export function makeTransmittanceLutShaderCode(transmittanceLutFormat: GPUTextureFormat = 'rgba16float') {
    return `${constantsWgsl}\n${intersectionWgsl}\n${mediumWgsl}\n${renderTransmittanceLutWgsl}`.replace('rgba16float', transmittanceLutFormat);
}

export function makeMultiScatteringLutShaderCode(multiScatteringLutFormat: GPUTextureFormat = 'rgba16float') {
    return `${constantsWgsl}\n${intersectionWgsl}\n${mediumWgsl}\n${phaseWgsl}\n${uvWgsl}\n${renderMultiScatteringLutWgsl}`.replace('rgba16float', multiScatteringLutFormat);
}

export function makeSkyViewLutShaderCode(skyViewLutFormat: GPUTextureFormat = 'rgba16float') {
    return `${constantsWgsl}\n${intersectionWgsl}\n${mediumWgsl}\n${phaseWgsl}\n${uvWgsl}\n${configWgsl}\n${coordinateSystemWgsl}\n${multipleScatteringWgsl}\n${renderSkyViewLutWgsl}`.replace('rgba16float', skyViewLutFormat);
}

export function makeAerialPerspectiveLutShaderCode(aerialPerspectiveLutFormat: GPUTextureFormat = 'rgba16float') {
    return `${constantsWgsl}\n${intersectionWgsl}\n${mediumWgsl}\n${phaseWgsl}\n${uvWgsl}\n${configWgsl}\n${coordinateSystemWgsl}\n${multipleScatteringWgsl}\n${aerialPerspectiveWgsl}\n${renderAerialPerspectiveWgsl}`.replace('rgba16float', aerialPerspectiveLutFormat);
}

export function makeRenderSkyWithLutsShaderCode(renderTargetFormat: GPUTextureFormat = 'rgba16float') {
    return `${constantsWgsl}\n${intersectionWgsl}\n${mediumWgsl}\n${phaseWgsl}\n${uvWgsl}\n${configWgsl}\n${coordinateSystemWgsl}\n${aerialPerspectiveWgsl}\n${skyViewWgsl}\n${blendWgsl}\n${sunDiskWgsl}\n${fullScreenVertexShaderWgsl}\n${renderSkyWithLutsWgsl}`.replace('rgba16float', renderTargetFormat);
}

export function makeRenderSkyRaymarchingShaderCode(renderTargetFormat: GPUTextureFormat = 'rgba16float') {
    return `${constantsWgsl}\n${intersectionWgsl}\n${mediumWgsl}\n${phaseWgsl}\n${uvWgsl}\n${configWgsl}\n${coordinateSystemWgsl}\n${multipleScatteringWgsl}\n${blendWgsl}\n${sunDiskWgsl}\n${fullScreenVertexShaderWgsl}\n${renderSkyRaymarchingWgsl}`.replace('rgba16float', renderTargetFormat);
}