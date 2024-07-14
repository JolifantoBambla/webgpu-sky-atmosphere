import { Atmosphere } from './atmosphere.js';

export interface TransmittanceLutConfig {
    /**
     * The size of the transmittance look up table.
     *
     * Defaults to [256, 64]
     */
    size?: [number, number],

    /**
     * The format of the transmittance look up table.
     *
     * Must support `GPUTextureUsage.STORAGE_BINDING` with `"write-only"` access.
     * Must support `GPUTextureSampleType` `"float"`.
     * Should be at least a three component format.
     *
     * Defaults to: 'rgba16float'
     */
    format?: GPUTextureFormat,

    /**
     * The ray marching sample count to use when rendering the transmittance look up table.
     *
     * Clamped to `max(40, sampleCount)`
     *
     * Defaults to 40
     */
    sampleCount?: number,
}

export interface MultiScatteringLutConfig {
    /**
     * The size of the multiple scattering look up table.
     *
     * Defaults to [32, 32]
     */
    size?: [number, number],

    /**
     * The format of the multiple scattering look up table.
     *
     * Must support `GPUTextureUsage.STORAGE_BINDING` with `"write-only"` access.
     * Must support `GPUTextureSampleType` `"float"`.
     * Should be at least a three component format.
     *
     * Defaults to: 'rgba16float'
     */
    format?: GPUTextureFormat,

    /**
     * The ray marching sample count to use when rendering the multiple scattering look up table.
     *
     * Clamped to `max(10, sampleCount)`
     *
     * Defaults to 20
     */
    sampleCount?: number,
}

export interface SkyViewLutConfig {
    /**
     * The size of the sky view look up table.
     *
     * Defaults to [192, 108]
     */
    size?: [number, number],

    /**
     * The format of the sky view look up table.
     *
     * Must support `GPUTextureUsage.STORAGE_BINDING` with `"write-only"` access.
     * Must support `GPUTextureSampleType` `"float"`.
     * Should be at least a three component format.
     *
     * Defaults to: 'rgba16float'
     */
    format?: GPUTextureFormat,
}

export interface AerialPerspectiveLutConfig {
    /**
     * The size of the aerial perspective look up table.
     *
     * Defaults to [32, 32, 32]
     */
    size?: [number, number, number],

    /**
     * The format of the aerial perspective look up table.
     *
     * Must support `GPUTextureUsage.STORAGE_BINDING` with `"write-only"` access.
     * Must support `GPUTextureSampleType` `"float"`.
     * Should be at least a three component format.
     *
     * Defaults to: 'rgba16float'
     */
    format?: GPUTextureFormat,

    /**
     * The distance each slice of the areal perspective look up table covers.
     *
     * This distance should be measured in the same units as {@link Atmosphere} parameters (e.g., {@link Atmosphere.bottomRadius}).
     *
     * Defaults to 4 * {@link SkyAtmosphereConfig.distanceScaleFactor}.
     */
    distancePerSlice?: number
}

/**
 * Config for internally used look up tables.
 */
export interface SkyAtmosphereLutConfig {
    /**
     * Settings for the transmittance look up table.
     */
    transmittanceLut?: TransmittanceLutConfig,

    /**
     * Settings for the multiple scattering look up table.
     */
    multiScatteringLut?: MultiScatteringLutConfig,

    /**
     * Settings for the sky view look up table.
     */
    skyViewLut?: SkyViewLutConfig,

    /**
     * Settings for the aerial perspective look up table.
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
     * Must support the STORAGE_BINDING usage.
     * Its format must support 'write-only' access.
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
     * If this this true, colored transmittance will be used to blend the rendered sky and the texture data in the {@link backBuffer} when using the per-pixel ray marching pass to render the sky.
     *
     * Defaults to true.
     */
    useColoredTransmittanceOnPerPixelRayMarch?: boolean,
}

/**
 * Config for rendering the sky / atmosphere using a GPURenderPipeline.
 */
export interface SkyRenderPassConfig {
    /**
     * The format of the render target at location 0.
     *
     * Must support RENDER_ATTACHMENT usage.
     * Should have at least 16 bit precision per channel.
     */
    renderTargetFormat: GPUTextureFormat,

    /**
     * If this is set, all render passes will be configured to use two render targets, where transmission will be written to the second render target using this format.
     *
     * If {@link useDualSourceBlending} is true and the device supports the `"dual-source-blending"` feature, both targets will be blended with the render target at location 0 using dual-source blending.
     * If {@link useDualSourceBlending} is true and the device does not support the `"dual-source-blending"` feature, both targets will be overwritten and no blending will be performed. It is the user's responsibility to blend the results in an extra pass.
     * If {@link useDualSourceBlending} is false, scattered luminance is blended with the texture at location 0 based on monochrome transmittance, and transmittance will be written to the render target at location 1 separately.
     *
     * If {@link writeTransmissionOnlyOnPerPixelRayMarch} is true, this setting does not affect the sky rendering pass using the aerial perspective look up table. It will instead be configured to expect a single render target at location 0.
     */
    transmissionFormat?: GPUTextureFormat,

    /**
     * Use dual-source blending for colored transmissions.
     *
     * Note that...
     *  - colored transmissions are only supported when using per-pixel ray marching instead of the aerial perspective look up table.
     *  - without the "dual-source-blending" feature enabled, colored transmissions can only be rendered using a compute pipeline or by blending scattered luminance and transmittance in an extra pass (this is currently not done by the {@link SkyAtmosphereRenderer} and is left to the user).
     *
     * Defaults to false.
     */
    useDualSourceBlending?: boolean,

    /**
     * Only configure the more expensive per-pixel ray marching pass to use a second render target and write colored transmittance.
     *
     * Note that the faster pass using the aerial perspective look up table does not support colored transmittance anyway and thus writing to a second render target is an extra cost without any benefit.
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
     * This setting defines whether {@link SkyAtmosphereRenderer} will use render or compute pipelines to render the atmosphere.
     */
    passConfig: SkyRendererComputePassConfig | SkyRenderPassConfig,

    /**
     * The depth buffer to limit the ray marching distance when rendering the sky / atmosphere.
     */
    depthBuffer: DepthBufferConfig,

    /**
     * If this is true, {@link SkyAtmosphereRenderer.renderSkyAtmosphere} will default to per-pixel ray marching to render the atmosphere.
     *
     * Defaults to false.
     */
    defaultToPerPixelRayMarch?: boolean,

    /**
     * Distance at which the maximum number of sampler per ray is used when ray marching the sky (either when rendering the sky view look up table or when ray marching the sky per pixel).
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
 * Config for external resources required to render volumetric shadows.
 */
export interface ShadowConfig {
    /**
     * A bind group layout specifying all resources required to render volumetric shadows.
     */
    bindGroupLayouts: GPUBindGroupLayout[],

    /**
     * A bind group generated using the {@link bindGroupLayouts}, containing all resources required to render volumetric shadows.
     */
    bindGroups: GPUBindGroup[],

    /**
     * The shader code to inject into the ray marching pipelines to render volumetric shadows.
     *
     * This needs to provide at least a function with the following signature:
     *
     *      fn get_shadow(world_space_position: vec3<f32>, light_index: u32) -> f32
     *
     * The function should return a floating point value in the range [0, 1], where 1 implies that the given world space position is not in shadow.
     *
     * It should also include the bind group matching the given {@link bindGroupLayouts}.
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
     * Use the second atmosphere light source specified in {@link Uniforms.moon}.
     *
     * Defaults to false.
     */
    useMoon?: boolean,
}

export interface SkyAtmosphereConfig {
    /**
     * Defaults to 'atmosphere'
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
     * @see makeEarthAtmosphere
     */
    atmosphere?: Atmosphere,

    /**
     * External resources and settings required by a {@link SkyAtmosphereRenderer}.
     */
    skyRenderer: SkyRendererPassConfig,

    /**
     * Atmosphere light config.
     */
    lights?: AtmosphereLightsConfig,

    /**
     * External resources required by a {@link SkyAtmosphereRenderer} to render volumetric shadows.
     */
    shadow?: ShadowConfig,

    /**
     * Config for internally used look up tables.
     */
    lookUpTables?: SkyAtmosphereLutConfig,
}
