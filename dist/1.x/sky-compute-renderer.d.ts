/// <reference types="dist" />
import { Atmosphere } from './atmosphere.js';
import { SkyAtmosphereComputeRendererConfig } from './config.js';
import { SkyAtmosphereRenderer, SkyAtmosphereLutRenderer } from './lut-renderer.js';
import { SkyAtmospherePipelines } from './pipelines.js';
import { SkyAtmosphereResources } from './resources.js';
import { Uniforms } from './uniforms.js';
export interface SkyAtmosphereComputeRendererResizeConfig {
    /**
     * The back buffer texture to use as back ground when rendering the sky / atmosphere using a GPUComputePipeline.
     *
     * If this is a texture, a texture view will be created.
     *
     * Should have the same size as the other textures.
     */
    backBuffer: GPUTextureView | GPUTexture;
    /**
     * The depth buffer to limit the ray marching distance when rendering the sky / atmosphere.
     *
     * If this is a textue, a texture view will be created.
     *
     * If this is a texture view, it must be allowed to be bound as a `texture<f32>`.
     * I.e., if the texture has a depth-stencil format, the texture view must be a `"depth-only"` view.
     *
     * Should have the same size as the other textures.
     */
    depthBuffer: GPUTextureView | GPUTexture;
    /**
     * The render target to render into when using a GPUComputePipeline to render the sky / atmosphere.
     *
     * If this is a texture, a texture view will be created.
     *
     * Should have the same size as the other textures.
     */
    renderTarget: GPUTextureView | GPUTexture;
    /**
     * The new size of the textures.
     *
     * If this is undefined, the new size is determined from the given resources, i.e., at least one of {@link backBuffer}, {@link depthBuffer}, and {@link renderTarget} must be a `GPUTexture`.
     */
    size?: [number, number];
}
declare abstract class SkyComputeRenderer implements SkyAtmosphereRenderer {
    protected lutRenderer: SkyAtmosphereLutRenderer;
    protected bindGroupLayout: GPUBindGroupLayout;
    private pass;
    protected doesRayMarchDistantSky: boolean;
    constructor(lutRenderer: SkyAtmosphereLutRenderer, bindGroupLayout: GPUBindGroupLayout, pipeline: GPUComputePipeline, config: SkyAtmosphereComputeRendererConfig, isRayMarchPass: boolean);
    protected static makeExternalBindGroupLayoutEntries(config: SkyAtmosphereComputeRendererConfig): GPUBindGroupLayoutEntry[];
    protected makeExternalBindGroupEntries(config: SkyAtmosphereComputeRendererResizeConfig): GPUBindGroupEntry[];
    protected abstract makeBindGroup(config: SkyAtmosphereComputeRendererResizeConfig): GPUBindGroup;
    /**
     * Replaces potentially screen-size dependent external resources (back buffer, depth buffer, and render target) in the internal bind groups.
     *
     * @param config Configuration of external resources.
     */
    onResize(config: SkyAtmosphereComputeRendererResizeConfig): void;
    /**
     * Renders the sky / atmosphere.
     *
     * @param passEncoder A `GPUComputePassEncoder` to encode the pass with. Can be the same encoder used to initialize lookup tables required. The encoder is not `end()`ed by this function.
     */
    renderSky(passEncoder: GPUComputePassEncoder): void;
    /**
     * Renders the sky / atmosphere, as well as all look up tables required.
     *
     * To initialize or update the transmittance and multiple scattering lookup tables, pass new {@link Atmosphere} paramters to this function or use the `forceConstantLutRendering` parameter.
     *
     * @param passEncoder A `GPUComputePassEncoder` to encode passes with. The encoder is not `end()`ed by this function.
     * @param uniforms {@link Uniforms} to use for this frame. If this is given, the internal uniform buffer will be updated using {@link updateUniforms}.
     * @param atmosphere {@link Atmosphere} parameters to use for this frame. If this is given, the internal uniform buffer storing the {@link Atmosphere} parameters will be updated and the transmittance and multiple scattering lookup tables will be rendered.
     * @param forceConstantLutRendering If this is true, the transmittance and multiple scattering lookup tables will be rendered regardless of whether the `atmosphere` parameter is `undefined` or not.
     *
     * @see {@link renderLuts}: Renders the lookup tables required for rendering the sky / atmosphere.
     * @see {@link renderSky}: Renders the sky / atmosphere.
     */
    abstract renderLutsAndSky(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms, atmosphere?: Atmosphere, forceConstantLutRendering?: boolean): void;
    updateAtmosphere(atmosphere: Atmosphere): void;
    updateUniforms(uniforms: Uniforms): void;
    renderTransmittanceLut(passEncoder: GPUComputePassEncoder): void;
    renderMultiScatteringLut(passEncoder: GPUComputePassEncoder): void;
    renderConstantLuts(passEncoder: GPUComputePassEncoder, atmosphere?: Atmosphere): void;
    renderSkyViewLut(passEncoder: GPUComputePassEncoder): void;
    renderAerialPerspectiveLut(passEncoder: GPUComputePassEncoder): void;
    renderDynamicLuts(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms): void;
    renderLuts(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms, atmosphere?: Atmosphere, useFullResolutionRayMarch?: boolean, forceConstantLutRendering?: boolean, forceSkyViewLutRendering?: boolean): void;
    get resources(): SkyAtmosphereResources;
}
/**
 * A sky / atmosphere renderer that renders the sky based on lookup tables.
 * It uses `GPUComputePipeline`s to render the sky / atmosphere.
 */
export declare class SkyWithLutsComputeRenderer extends SkyComputeRenderer {
    private constructor();
    private static makeBindGroupLayout;
    private static makeWithLutsPiplelineDescriptor;
    /**
     * Asynchronously creates a {@link SkyAtmosphereComputeRenderer}.
     *
     * All pipelines used by this renderer are created asynchronously.
     *
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingLutRenderer If this is defined, no new internal {@link SkyAtmosphereLutRenderer} will be created. Instead, the existing one is used.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static createAsync(device: GPUDevice, config: SkyAtmosphereComputeRendererConfig, existingLutRenderer?: SkyAtmosphereLutRenderer, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources): Promise<SkyWithLutsComputeRenderer>;
    /**
     * Creates a {@link SkyAtmosphereComputeRenderer}.
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingLutRenderer If this is defined, no new internal {@link SkyAtmosphereLutRenderer} will be created. Instead, the existing one is used.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static create(device: GPUDevice, config: SkyAtmosphereComputeRendererConfig, existingLutRenderer?: SkyAtmosphereLutRenderer, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources): SkyWithLutsComputeRenderer;
    protected makeBindGroup(config: SkyAtmosphereComputeRendererResizeConfig): GPUBindGroup;
    renderLutsAndSky(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms, atmosphere?: Atmosphere, forceConstantLutRendering?: boolean): void;
}
/**
 * A sky / atmosphere renderer that renders the sky using full-resolution ray marching.
 * It uses `GPUComputePipeline`s to render the sky / atmosphere.
 */
export declare class SkyRayMarchComputeRenderer extends SkyComputeRenderer {
    private constructor();
    private static makeBindGroupLayout;
    private static makeRayMarchPipelineDescriptor;
    /**
     * Asynchronously creates a {@link SkyAtmosphereComputeRenderer}.
     *
     * All pipelines used by this renderer are created asynchronously.
     *
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingLutRenderer If this is defined, no new internal {@link SkyAtmosphereLutRenderer} will be created. Instead, the existing one is used.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static createAsync(device: GPUDevice, config: SkyAtmosphereComputeRendererConfig, existingLutRenderer?: SkyAtmosphereLutRenderer, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources): Promise<SkyRayMarchComputeRenderer>;
    /**
     * Creates a {@link SkyAtmosphereComputeRenderer}.
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingLutRenderer If this is defined, no new internal {@link SkyAtmosphereLutRenderer} will be created. Instead, the existing one is used.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static create(device: GPUDevice, config: SkyAtmosphereComputeRendererConfig, existingLutRenderer?: SkyAtmosphereLutRenderer, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources): SkyRayMarchComputeRenderer;
    protected makeBindGroup(config: SkyAtmosphereComputeRendererResizeConfig): GPUBindGroup;
    renderLutsAndSky(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms, atmosphere?: Atmosphere, forceConstantLutRendering?: boolean): void;
    get rayMarchDistantSky(): boolean;
}
/**
 * A {@link SkyAtmosphereLutRenderer} that uses `GPUComputePipeline`s to render the sky / atmosphere.
 */
export declare class SkyAtmosphereComputeRenderer implements SkyAtmosphereRenderer {
    private lutRenderer;
    private withLutsRenderer;
    private rayMarchRenderer;
    defaultToFullResolutionRayMarch: boolean;
    private constructor();
    /**
     * Asynchronously creates a {@link SkyAtmosphereComputeRenderer}.
     *
     * All pipelines used by this renderer are created asynchronously.
     *
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingLutRenderer If this is defined, no new internal {@link SkyAtmosphereLutRenderer} will be created. Instead, the existing one is used.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static createAsync(device: GPUDevice, config: SkyAtmosphereComputeRendererConfig, existingLutRenderer?: SkyAtmosphereLutRenderer, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources): Promise<SkyAtmosphereComputeRenderer>;
    /**
     * Creates a {@link SkyAtmosphereComputeRenderer}.
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingLutRenderer If this is defined, no new internal {@link SkyAtmosphereLutRenderer} will be created. Instead, the existing one is used.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static create(device: GPUDevice, config: SkyAtmosphereComputeRendererConfig, existingLutRenderer?: SkyAtmosphereLutRenderer, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources): SkyAtmosphereComputeRenderer;
    /**
     * Replaces potentially screen-size dependent external resources (back buffer, depth buffer, and render target) in the internal bind groups.
     *
     * @param config Configuration of external resources.
     */
    onResize(config: SkyAtmosphereComputeRendererResizeConfig): void;
    /**
     * Renders the sky / atmosphere using precomputed lookup tables.
     *
     * Requires the sky view and aerial perspective lookup tables to be initialized.
     * To initialize these lookup tables, call {@link renderDynamicLuts}.
     *
     * @param passEncoder A `GPUComputePassEncoder` to encode the pass with. Can be the same encoder used to initialize the sky view and aerial perspective lookup tables. The encoder is not `end()`ed by this function.
     *
     * @see {@link renderDynamicLuts}: To initialize the lookup tables required, call this function.
     */
    renderSkyWithLuts(passEncoder: GPUComputePassEncoder): void;
    /**
     * Renders the sky / atmosphere using full-resolution ray marching.
     *
     * Requires the transmittance and multiple scattering lookup tables to be initialized.
     * Either initialize these lookup tables in the constructor using {@link SkyAtmosphereRendererConfig.initializeConstantLuts}, or call {@link renderConstantLuts}.
     *
     * @param passEncoder A `GPUComputePassEncoder` to encode the pass with. Can be the same encoder used to initialize the transmittance and multiple scattering lookup tables. The encoder is not `end()`ed by this function.
     *
     * @see {@link renderConstantLuts}: To initialize the lookup tables required, call this function.
     */
    renderSkyRaymarching(passEncoder: GPUComputePassEncoder): void;
    /**
     * Renders the sky / atmosphere using either lookup tables or full-resolution ray marching, as well as all look up tables required by the respective approach.
     *
     * @param passEncoder A `GPUComputePassEncoder` to encode the sky / atmosphere rendering pass with. The encoder is not `end()`ed by this function.
     * @param useFullResolutionRayMarch If this is true, full-resolution ray marching will be used to render the sky / atmosphere. Defaults to {@link defaultToFullResolutionRayMarch}.
     *
     * @see {@link renderSkyWithLuts}: Renders the sky with lookup tables.
     * @see {@link renderSkyRaymarching}: Renders the sky with full-resolution ray marching.
     */
    renderSky(passEncoder: GPUComputePassEncoder, useFullResolutionRayMarch?: boolean): void;
    /**
     * Renders the sky / atmosphere using either lookup tables or full-resolution ray marching, as well as all look up tables required by the respective approach.
     *
     * To initialize or update the transmittance and multiple scattering lookup tables, pass new {@link Atmosphere} paramters to this function or use the `forceConstantLutRendering` parameter.
     *
     * @param passEncoder A `GPUComputePassEncoder` to encode passes with. The encoder is not `end()`ed by this function.
     * @param uniforms {@link Uniforms} to use for this frame. If this is given, the internal uniform buffer will be updated using {@link updateUniforms}.
     * @param atmosphere {@link Atmosphere} parameters to use for this frame. If this is given, the internal uniform buffer storing the {@link Atmosphere} parameters will be updated and the transmittance and multiple scattering lookup tables will be rendered.
     * @param useFullResolutionRayMarch If this is true, full-resolution ray marching will be used to render the sky / atmosphere. In that case, the sky view and aerial perspective lookup tables will not be rendered. Defaults to {@link defaultToFullResolutionRayMarch}.
     * @param forceConstantLutRendering If this is true, the transmittance and multiple scattering lookup tables will be rendered regardless of whether the `atmosphere` parameter is `undefined` or not.
     *
     * @see {@link renderLuts}: Renders the lookup tables required for rendering the sky / atmosphere.
     * @see {@link renderSky}: Renders the sky / atmosphere using either low-resolution lookup tables or full-resolution ray marching.
     */
    renderLutsAndSky(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms, atmosphere?: Atmosphere, useFullResolutionRayMarch?: boolean, forceConstantLutRendering?: boolean): void;
    updateAtmosphere(atmosphere: Atmosphere): void;
    updateUniforms(uniforms: Uniforms): void;
    renderTransmittanceLut(passEncoder: GPUComputePassEncoder): void;
    renderMultiScatteringLut(passEncoder: GPUComputePassEncoder): void;
    renderConstantLuts(passEncoder: GPUComputePassEncoder, atmosphere?: Atmosphere): void;
    renderSkyViewLut(passEncoder: GPUComputePassEncoder): void;
    renderAerialPerspectiveLut(passEncoder: GPUComputePassEncoder): void;
    renderDynamicLuts(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms): void;
    renderLuts(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms, atmosphere?: Atmosphere, useFullResolutionRayMarch?: boolean, forceConstantLutRendering?: boolean, forceSkyViewLutRendering?: boolean): void;
    get resources(): SkyAtmosphereResources;
}
export {};
