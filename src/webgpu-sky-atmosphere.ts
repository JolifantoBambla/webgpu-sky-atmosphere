/*
 * Copyright (c) 2024-2025 Lukas Herzberger
 * SPDX-License-Identifier: MIT
 */

import {
    Absorption,
    AbsorptionLayer0,
    AbsorptionLayer1,
    Atmosphere,
    makeEarthAtmosphere,
    Mie,
    Rayleigh,
} from './atmosphere.js';

import {
    AerialPerspectiveLutConfig,
    AtmosphereLightsConfig,
    ComputeBackBufferConfig,
    ComputeRenderTargetConfig,
    CustomUniformsSourceConfig,
    DepthBufferConfig,
    FullResolutionRayMarchConfig,
    MieHgDPhaseConfig,
    MultiScatteringLutConfig,
    ShadowConfig,
    SkyRendererComputeConfig,
    SkyAtmosphereLutConfig,
    SkyAtmosphereRendererConfig,
    SkyAtmosphereComputeRendererConfig,
    SkyRendererConfigBase,
    SkyRendererRasterConfig,
    SkyAtmosphereRasterRendererConfig,
    SkyViewLutConfig,
    SkyViewUniformParameterizationConfig,
    TransmittanceLutConfig,
} from './config.js';

import {
    SkyAtmosphereLutRenderer,
    SkyAtmosphereRenderer,
} from './lut-renderer.js';

import {
    SkyAtmosphereComputeRenderer,
    SkyAtmosphereComputeRendererResizeConfig,
    SkyWithLutsComputeRenderer,
    SkyRayMarchComputeRenderer,
} from './sky-compute-renderer.js';

import {
    SkyAtmosphereRasterRenderer,
    SkyWithLutsRasterRenderer,
    SkyRayMarchRasterRenderer,
} from './sky-raster-renderer.js';

import { Camera, AtmosphereLight, Uniforms } from './uniforms.js';
import {
    atmosphereToFloatArray,
    ATMOSPHERE_BUFFER_SIZE,
    uniformsToFloatArray,
    UNIFORMS_BUFFER_SIZE,
    SkyAtmosphereResources,
} from './resources.js';

import { ComputePass, LookUpTable, RenderPass } from './util.js';

export {
    Absorption,
    AbsorptionLayer0,
    AbsorptionLayer1,
    Atmosphere,
    makeEarthAtmosphere,
    Mie,
    Rayleigh,
};

export {
    AerialPerspectiveLutConfig,
    AtmosphereLightsConfig,
    ComputeBackBufferConfig,
    ComputeRenderTargetConfig,
    CustomUniformsSourceConfig,
    DepthBufferConfig,
    FullResolutionRayMarchConfig,
    MieHgDPhaseConfig,
    MultiScatteringLutConfig,
    ShadowConfig,
    SkyRendererComputeConfig,
    SkyAtmosphereLutConfig,
    SkyAtmosphereRendererConfig,
    SkyAtmosphereComputeRendererConfig,
    SkyRendererConfigBase,
    SkyRendererRasterConfig,
    SkyAtmosphereRasterRendererConfig,
    SkyViewLutConfig,
    SkyViewUniformParameterizationConfig,
    TransmittanceLutConfig,
};

export {
    SkyAtmosphereLutRenderer,
    SkyAtmosphereRenderer,
};

export {
    SkyAtmosphereComputeRenderer,
    SkyAtmosphereComputeRendererResizeConfig,
    SkyWithLutsComputeRenderer,
    SkyRayMarchComputeRenderer,
};

export {
    SkyAtmosphereRasterRenderer,
    SkyWithLutsRasterRenderer,
    SkyRayMarchRasterRenderer,
};

export {
    Camera,
    AtmosphereLight,
    Uniforms,
};

export {
    atmosphereToFloatArray,
    ATMOSPHERE_BUFFER_SIZE,
    uniformsToFloatArray,
    UNIFORMS_BUFFER_SIZE,
    SkyAtmosphereResources,
};

export {
    ComputePass,
    LookUpTable,
    RenderPass,
};

