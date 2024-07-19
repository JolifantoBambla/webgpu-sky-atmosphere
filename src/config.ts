import { Atmosphere } from './atmosphere.js';

export interface TransmittanceLutConfig {
    /**
     * The size of the transmittance lookup table.
     *
     * Defaults to [256, 64]
     */
    size?: [number, number],

    /**
     * The format of the transmittance lookup table.
     *
     * Must support `GPUTextureUsage.STORAGE_BINDING` with `"write-only"` access.
     * Must support `GPUTextureSampleType` `"float"`.
     * Should be at least a three component format.
     *
     * Defaults to: `"rgba16float"`
     */
    format?: GPUTextureFormat,

    /**
     * The ray marching sample count to use when rendering the transmittance lookup table.
     *
     * Clamped to `max(40, sampleCount)`
     *
     * Defaults to 40
     */
    sampleCount?: number,
}

export interface MultiScatteringLutConfig {
    /**
     * The size of the multiple scattering lookup table.
     *
     * Defaults to [32, 32]
     */
    size?: [number, number],

    /**
     * The format of the multiple scattering lookup table.
     *
     * Must support `GPUTextureUsage.STORAGE_BINDING` with `"write-only"` access.
     * Must support `GPUTextureSampleType` `"float"`.
     * Should be at least a three component format.
     *
     * Defaults to: `"rgba16float"`
     */
    format?: GPUTextureFormat,

    /**
     * The ray marching sample count to use when rendering the multiple scattering lookup table.
     *
     * Clamped to `max(10, sampleCount)`
     *
     * Defaults to 20
     */
    sampleCount?: number,
}

export interface SkyViewLutConfig {
    /**
     * The size of the sky view lookup table.
     *
     * Defaults to [192, 108]
     */
    size?: [number, number],

    /**
     * The format of the sky view lookup table.
     *
     * Must support `GPUTextureUsage.STORAGE_BINDING` with `"write-only"` access.
     * Must support `GPUTextureSampleType` `"float"`.
     * Should be at least a three component format.
     *
     * Defaults to: `"rgba16float"`
     */
    format?: GPUTextureFormat,

    /**
     * If this is true and {@link SkyAtmosphereConfig.shadow} is defined, user-controlled shadow mapping will be evaluated for every sample when rendering the sky view lookup table.
     *
     * Defaults to true.
     */
    affectedByShadow?: boolean,
}

export interface AerialPerspectiveLutConfig {
    /**
     * The size of the aerial perspective lookup table.
     *
     * Defaults to [32, 32, 32]
     */
    size?: [number, number, number],

    /**
     * The format of the aerial perspective lookup table.
     *
     * Must support `GPUTextureUsage.STORAGE_BINDING` with `"write-only"` access.
     * Must support `GPUTextureSampleType` `"float"`.
     * Should be at least a three component format.
     *
     * Defaults to: `"rgba16float"`
     */
    format?: GPUTextureFormat,

    /**
     * The distance each slice of the areal perspective lookup table covers.
     *
     * This distance should be measured in the same units as {@link Atmosphere} parameters (e.g., {@link Atmosphere.bottomRadius}).
     *
     * Defaults to 4 * {@link SkyAtmosphereConfig.distanceScaleFactor}.
     */
    distancePerSlice?: number
}

/**
 * Config for internally used lookup tables.
 */
export interface SkyAtmosphereLutConfig {
    /**
     * Settings for the transmittance lookup table.
     */
    transmittanceLut?: TransmittanceLutConfig,

    /**
     * Settings for the multiple scattering lookup table.
     */
    multiScatteringLut?: MultiScatteringLutConfig,

    /**
     * Settings for the sky view lookup table.
     */
    skyViewLut?: SkyViewLutConfig,

    /**
     * Settings for the aerial perspective lookup table.
     */
    aerialPerspectiveLut: AerialPerspectiveLutConfig,
}

/**
 * The back buffer texture to use as back ground when rendering the sky / atmosphere using a GPUComputePipeline.
 */
export interface ComputeBackBufferConfig {
    /**
     * The back buffer texture.
     */
    texture: GPUTexture,

    /**
     * A texture view to use for the back buffer.
     *
     * If this is not present, a new view is created from the given {@link texture}.
     */
    view?: GPUTextureView,
}

/**
 * The depth buffer to limit the ray marching distance when rendering the sky / atmosphere.
 */
export interface DepthBufferConfig {
    /**
     * The depth buffer texture.
     */
    texture: GPUTexture,

    /**
     * A texture view to use for the depth buffer.
     * If {@link texture} has a depth-stencil format, this view must be a "depth-only" view (to support binding it as a `texture_2d<f32>`).
     *
     * If this is not present, a new view is created from the given {@link texture}.
     */
    view?: GPUTextureView,

    /**
     * Specifiy if the depth buffer range is [0, 1] (reverse z) or [1, 0] (default).
     * Defaults to false.
     */
    reverseZ?: boolean,
}

/**
 * The render target to render into when using a GPUComputePipeline to render the sky / atmosphere.
 */
export interface ComputeRenderTargetConfig {
    /**
     * Must support the `STORAGE_BINDING` usage.
     * Its format must support `"write-only"` access.
     * Its format should have at least 16 bit precision per channel.
     *
     * Must not be the same texture as the back or depth buffer.
     */
    texture: GPUTexture,

    /**
     * A texture view to use for the render target.
     * If this is not present, a new view is created from the given {@link texture}.
     */
    view?: GPUTextureView,
}

/**
 * Config for rendering the sky / atmosphere using a GPUComputePipeline.
 */
export interface SkyRendererComputePassConfig {
    /**
     * The back buffer texture to use as back ground for rendering the sky / atmosphere.
     */
    backBuffer: ComputeBackBufferConfig,

    /**
     * The render target to render into.
     * The result will be blended with the texture data in the {@link backBuffer}.
     */
    renderTarget: ComputeRenderTargetConfig,

    /**
     * If this this true, colored transmittance will be used to blend the rendered sky and the texture data in the {@link backBuffer} when using the full-screen ray marching pass to render the sky.
     *
     * Defaults to true.
     */
    useColoredTransmittanceOnPerPixelRayMarch?: boolean,
}

/**
 * Config for rendering the sky / atmosphere using a `GPURenderPipeline`.
 */
export interface SkyRenderPassConfig {
    /**
     * The format of the render target at location 0.
     *
     * Must support `RENDER_ATTACHMENT` usage.
     * Should have at least 16 bit precision per channel.
     */
    renderTargetFormat: GPUTextureFormat,

    /**
     * Use dual-source blending for colored transmissions.
     *
     * Note that colored transmissions are only supported when using full-screen ray marching instead of the aerial perspective lookup table.
     * 
     * Without the "dual-source-blending" feature enabled, colored transmissions can only be rendered using a compute pipeline or by writing luminance and transmittance to extra targets and blending them in an extra pass (see {@link transmissionFormat}, the blending step is then left to the user).
     *
     * Defaults to false.
     */
    useDualSourceBlending?: boolean,

    /**
     * If this is set and dual source blending is not enabled or not available, all render passes will be configured to use two render targets, where transmission will be written to the second render target using this format.
     * In this case, no blend state will be configured for the render target at location 0. Instead, blending is left to the user.
     * 
     * If {@link useDualSourceBlending} is true and the device support the `"dual-source-blending"` feature, this option is ignored.
     * 
     * If {@link writeTransmissionOnlyOnPerPixelRayMarch} is true, this setting does not affect the sky rendering pass using the aerial perspective lookup table. It will instead be configured to expect a single render target at location 0 and a blend state will be configured for the pipeline.
     */
    transmissionFormat?: GPUTextureFormat,

    /**
     * If this is true, a {@link transmissionFormat} is set, and dual source blending is not enabled or not available, only configure the more expensive full-screen ray marching pass to use a second render target and write colored transmittance.
     *
     * Note that the faster pass using the aerial perspective lookup table does not support colored transmittance anyway and thus writing to a second render target is an extra cost without any benefit.
     *
     * Defaults to true.
     */
    writeTransmissionOnlyOnPerPixelRayMarch?: boolean,
}

/**
 * External resources and settings required by a {@link SkyAtmosphereRenderer}.
 */
export interface SkyRendererPassConfig {
    /**
     * External resources required by a {@link SkyAtmosphereRenderer} when using a render or compute pipeline for rendering the atmosphere.
     *
     * This setting defines whether {@link SkyAtmosphereRenderer.makeSkyAtmosphereRenderer} will create a {@link SkyAtmosphereComputeRenderer} or a {@link SkyAtmosphereRasterRenderer}.
     */
    passConfig: SkyRendererComputePassConfig | SkyRenderPassConfig,

    /**
     * The depth buffer to limit the ray marching distance when rendering the sky / atmosphere.
     */
    depthBuffer: DepthBufferConfig,

    /**
     * If this is true, {@link SkyAtmosphereRasterRenderer.renderSky} / {@link SkyAtmosphereComputeRenderer.renderSkyAtmosphere} will default to full-screen ray marching to render the atmosphere.
     *
     * Defaults to false.
     */
    defaultToPerPixelRayMarch?: boolean,

    /**
     * Distance at which the maximum number of sampler per ray is used when ray marching the sky (either when rendering the sky view lookup table or when ray marching the sky per pixel).
     *
     * Should be in the same distance unit used for the {@link Atmosphere} parameters.
     *
     * Defaults to 100 * {@link SkyAtmosphereConfig.distanceScaleFactor}.
     */
    distanceToMaxSampleCount?: number,

    /**
     * Results in less sampling artefacts (e.g., smoother volumetric shadows) but introduces visible noise.
     * It is recommended to use temporal anti-aliasing to get rid of this noise.
     *
     * Defaults to true.
     */
    randomizeRayOffsets?: boolean,
}

/**
 * Config for external resources required for the aerial perspective lookup table to take shadowing into account and for render volumetric shadows when rendering the sky / atmosphere using full-screen ray marching.
 *
 * To integrate user-controlled shadow maps into the sky / atmosphere rendering passes, WGSL code needs to be injected into the shader code and the layouts of the respective sky rendering pipelines need to be created using external bind group layouts.
 */
export interface ShadowConfig {
    /**
     * A list of bind group layouts specifying all resources required to respect user-controlled shadow map(s) when rendering the aerial perspective lookup table or when doing full-screen ray marching.
     *
     * This should not contain more than `maxBindGroups - 1` bind group layouts, where `maxBindGroups` is the maximum number of bind group layouts per pipeline layout supported by the device.
     */
    bindGroupLayouts: GPUBindGroupLayout[],

    /**
     * A list of bind groups generated using the {@link bindGroupLayouts}, containing all resources required by the user-controlled shadow mapping implementation.
     */
    bindGroups: GPUBindGroup[],

    /**
     * The shader code to inject into the aerial perspective & full-screen ray marching pipelines.
     *
     * This needs to provide at least a function with the following signature:
     *
     *      fn get_shadow(world_space_position: vec3<f32>, light_index: u32) -> f32
     *
     * The function should return a floating point value in the range [0, 1], where 1 implies that the world space position given (`world_space_position`) is not in shadow.
     * The `light_index` parameter refers to the index of the atmosphere light, where `0` refers to {@link Uniforms.sun} and `1` refers to {@link Uniforms.moon}.
     *
     * It should also include the bind groups matching the given {@link bindGroupLayouts}.
     * The bind groups must not use bind group index 0.
     */
    wgslCode: string,
}

export interface AtmosphereLightsConfig {
    /**
     * Render a sun disk.
     *
     * Defaults to true.
     */
    renderSunDisk?: boolean,

    /**
     * Render a moon disk.
     *
     * Defaults to {@link useMoon}.
     */
    renderMoonDisk?: boolean,

    /**
     * Use the second atmosphere light source specified in {@link Uniforms.moon}.
     *
     * Defaults to false.
     */
    useMoon?: boolean,

    /**
     * If this is true, limb darkening is applied to the disk rendered for the first atmosphere light.
     * 
     * Defaults to true.
     */
    applyLimbDarkeningOnSun?: boolean,

    /**
     * If this is true, limb darkening is applied to the disk rendered for the second atmosphere light.
     * 
     * Defaults to false.
     */
    applyLimbDarkeningOnMoon?: boolean,
}

export interface SkyAtmosphereConfig {
    /**
     * A name used to lable internal resources and pipelines.
     *
     * Defaults to `"atmosphere"`
     */
    label?: string,

    /**
     * If true, all lookup tables that only depend on constant atmosphere parameters are rendered at creation time.
     *
     * Defaults to true.
     */
    initializeConstantLuts?: boolean,

    /**
     * A scale factor to apply to all distance-related parameters that are not explicitly set (e.g., {@link Atmosphere} or {@link AerialPerspectiveLutConfig.distancePerSlice}).
     *
     * Defaults to 1.0.
     */
    distanceScaleFactor?: number,

    /**
     * The atmosphere parameters for this {@link SkyAtmosphereRenderer}.
     * Defaults to: {@link makeEarthAtmosphere} with the scale parameter set to {@link SkyAtmosphereConfig.distanceScaleFactor}.
     * @see {@link makeEarthAtmosphere}
     */
    atmosphere?: Atmosphere,

    /**
     * Config parameters for rendering the sky required by a {@link SkyAtmosphereRenderer} (or a {@link SkyAtmosphereComputeRenderer} / {@link SkyAtmosphereRasterRenderer}).
     */
    skyRenderer: SkyRendererPassConfig,

    /**
     * Config for atmosphere lights (sun, moon, sun disk).
     */
    lights?: AtmosphereLightsConfig,

    /**
     * Config for external resources required by a {@link SkyAtmosphereRenderer} to integrate user-controlled shadow maps.
     */
    shadow?: ShadowConfig,

    /**
     * Config for internally used lookup tables.
     */
    lookUpTables?: SkyAtmosphereLutConfig,
}
