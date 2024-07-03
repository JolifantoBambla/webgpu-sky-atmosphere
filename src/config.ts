import { Atmosphere } from "./atmosphere.js";

export interface SkyAtmosphereLutConfig {
    /**
     * The size of the transmittance look up table.
     * Defaults to [256, 64]
     */
    transmittanceLutSize?: [number, number],

    /**
     * The ray marching sample count to use when rendering the transmittance look up table.
     * Defaults to 40
     * Clamped to max(40, transmittanceLutSampleCount)
     */
    transmittanceLutSampleCount?: number,

    /**
     * The size of the multiple scattering look up table.
     * Defaults to 32
     */
    multiScatteringLutSize?: number,

    /**
     * The ray marching sample count to use when rendering the multiple scattering look up table.
     * Defaults to 20
     * Clamped to max(10, multiScatteringLutSampleCount)
     */
    multiScatteringLutSampleCount?: number,

    /**
     * The size of the sky view look up table.
     * Defaults to [192, 108]
     */
    skyViewLutSize?: [number, number],

    /**
     * The size of of the aerial perspective look up table.
     * Defaults to [32, 32, 32]
     */
    aerialPerspectiveLutSize?: [number, number, number],
}

/**
 * Coordinate system specifics to interface with the user's system.
 */
export interface CoordinateSystemConfig {
    /**
     * Internally, {@link SkyAtmosphereRenderer} uses a left-handed coordinate system with the z axis pointing up.
     * To correctly interpret positions and directions passed in from the user side (such as the camera position or the sun light's direction),
     * specify if y is pointing up.
     * Defaults to true.
     */
    yUp?: boolean,
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
export interface SkyRendererComputeConfig {
    /**
     * The back buffer texture to use as back ground for rendering the sky / atmosphere.
     */
    backBuffer: ComputeBackBufferConfig,

    /**
     * The depth buffer to limit the ray marching distance when rendering the sky / atmosphere.
     */
    depthBuffer: DepthBufferConfig,

    /**
     * The render target to render into.
     */
    renderTarget: ComputeRenderTargetConfig,
}

/**
 * Config for rendering the sky / atmosphere using a GPURenderPipeline.
 */
export interface SkyRendererRenderConfig {
    /**
     * Must support RENDER_ATTACHMENT usage.
     * Should have at least 16 bit precision per channel. (todo: maybe r11g11b10 also enough?)
     */
    renderTargetFormat: GPUTextureFormat,

    /**
     * The depth buffer to limit the ray marching distance when rendering the sky / atmosphere.
     */
    depthBuffer: DepthBufferConfig,
}

/**
 * Config for external resources required to render volumetric shadows.
 */
export interface SkyRendererShadowConfig {
    /**
     * A bind group layout specifying all resources required to render volumetric shadows.
     */
    bindGroupLayout: GPUBindGroupLayout,

    /**
     * A bind group generated using the {@link bindGroupLayout}, containing all resources required to render volumetric shadows.
     */
    bindGroup: GPUBindGroup,

    /**
     * The shader code to inject into the ray marching pipelines to render volumetric shadows.
     *
     * This needs to provide at least a function with the following signature:
     *
     *      fn get_shadow(world_space_position: vec3<f32>) -> f32
     *
     * The function should return a floating point value in the range [0, 1], where 1 implies that the given world space position is not in shadow.
     *
     * It should also include the bind group matching the given {@link bindGroupLayout}.
     * The bind group must use bind group index 2 (i.e., `@group(2)`).
     */
    wgslCode: string,
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
     * Coordinate system specifics to interface with the user's system.
     */
    coordinateSystem?: CoordinateSystemConfig,

    /**
     * Sets external resources required by a {@link SkyAtmosphereRenderer} when using a compute pipeline.
     *
     * At least one of {@link compute} and {@link render} must be set.
     *
     * Note that without the "dual-source-blending" feature enabled, colored transmissions can only be rendered using a compute pipeline.
     * Note that colored transmissions can only be rendered using the ray marching pipelines.
     *
     * One of {@link compute} and {@link render} must be set to specify if the sky / atmosphere should be rendered using a GPUComputePipeline or a GPURenderPipeline.
     */
    compute?: SkyRendererComputeConfig,

    /**
     * Sets external resources required by a {@link SkyAtmosphereRenderer} when using a render pipeline.
     *
     * Note that rendering colored transmisstion using a render pipeline is only possible with the "dual-source-blending" feature enabled.
     *
     * At least one of {@link compute} and {@link render} must be set.
     */
    render?: SkyRendererRenderConfig,

    /**
     * Sets external resources required by a {@link SkyAtmosphereRenderer} to render volumetric shadows.
     */
    shadow?: SkyRendererShadowConfig,

    /**
     * Config for internally used look up tables.
     */
    lookUpTables?: SkyAtmosphereLutConfig,
}
