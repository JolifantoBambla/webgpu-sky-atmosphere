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
     * Defaults to 4.
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
     */
    renderTarget: ComputeRenderTargetConfig,
}

/**
 * Config for rendering the sky / atmosphere using a GPURenderPipeline.
 */
export interface SkyRenderPassConfig {
    /**
     * Must support RENDER_ATTACHMENT usage.
     * Should have at least 16 bit precision per channel. (todo: maybe r11g11b10 also enough?)
     */
    renderTargetFormat: GPUTextureFormat,

    transmissionFormat?: GPUTextureFormat,

    /**
     * Use dual-source blending for colored transmissions.
     *
     * Since colored transmissions are only supported when rendering the atmosphere using ray marching, the more expensive ray marching pipelines will be used by default.
     *
     * Note that without the "dual-source-blending" feature enabled, colored transmissions can only be rendered using a compute pipeline.
     * If the feature is not enabled and the {@link SkyAtmosphereRenderer} is configured to use render pipelines, this flag has no effect.
     *
     * Defaults to false.
     */
    useDualSourceBlending?: boolean,
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
     * Used to determine whether to prefer colored transmissions when rendering the atmosphere using {@link SkyAtmosphereRenderer.render}.
     *
     * Since colored transmissions are only supported when rendering the atmosphere using ray marching, the more expensive ray marching pipelines will be used by default.
     *
     * Note that without the "dual-source-blending" feature enabled, colored transmissions can only be rendered using a compute pipeline.
     * If the feature is not enabled and the {@link SkyAtmosphereRenderer} is configured to use render pipelines, this flag has no effect.
     *
     * Defaults to false.
     */
    preferColoredTransmission?: boolean,

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
     * A bind group generated using the {@link bindGroupLayout}, containing all resources required to render volumetric shadows.
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
     * It should also include the bind group matching the given {@link bindGroupLayout}.
     * The bind groups must not use bind group index 0.
     */
    wgslCode: string,
}

/**
 * Config for user-defined light sources.
 */
interface CustomLightsConfig {
    /**
     * A set of bind group layouts.
     */
    bindGroupLayouts: GPUBindGroupLayout[],

    /**
     * A set of bind groups compatible with the {@link bindGroupLayout}.
     */
    bindGroups: GPUBindGroup[],

    /**
     * The shader code to replace the built-in light source definitions.
     *
     * This needs to provide at least the following functions with the following signatures:
     *
     *      fn get_number_of_light_sources() -> u32
     *      fn get_light_direction(light_index: u32) -> vec3<f32>
     *      fn get_light_illuminance(light_index: u32) -> vec3<f32>
     *      fn get_light_luminance(light_index: u32) -> vec3<f32>
     *      fn get_light_diameter(light_index: u32) -> vec3<f32>
     *
     * It should also include the bind groups matching the given {@link bindGroupLayouts}.
     * The bind groups must not use bind group index 0.
     */
    wgslCode: string,
}

/**
 * Config for user-defined uniforms.
 */
interface CustomUniformBuffersConfig {
    /**
     * A set of bind group layouts.
     */
    bindGroupLayouts: GPUBindGroupLayout[],

    /**
     * A set of bind groups compatible with the {@link bindGroupLayout}.
     */
    bindGroups: GPUBindGroup[],

    /**
     * The shader code to replace the built-in uniform definitions.
     *
     * This needs to provide at least the following functions with the following signatures:
     *
     *      fn get_camera_world_position() -> vec3<f32>
     *      fn get_camera_inverse_view() -> mat4x4<f32>
     *      fn get_camera_inverse_projection() -> mat4x4<f32>
     *      fn get_screen_resolution() -> vec2<f32>
     *      fn get_frame_id() -> f32
     *      fn get_ray_march_spp_min() -> f32
     *      fn get_ray_march_spp_max() -> f32
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
     * Defaults to true.
     */
    initializeConstantLuts?: boolean,

    /**
     * The atmosphere parameters for this {@link SkyAtmosphereRenderer}.
     * Defaults to: {@link makeEarthAtmosphere}
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
