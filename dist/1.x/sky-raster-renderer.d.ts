/// <reference types="dist" />
import { Atmosphere } from './atmosphere.js';
import { SkyAtmosphereRasterRendererConfig } from './config.js';
import { SkyAtmosphereRenderer, SkyAtmosphereLutRenderer } from './lut-renderer.js';
import { SkyAtmospherePipelines } from './pipelines.js';
import { SkyAtmosphereResources } from './resources.js';
import { Uniforms } from './uniforms.js';
declare abstract class SkyRasterRenderer implements SkyAtmosphereRenderer {
    readonly targetFormats: GPUTextureFormat[];
    readonly lutRenderer: SkyAtmosphereLutRenderer;
    protected bindGroupLayout: GPUBindGroupLayout;
    private pass;
    private bundle?;
    protected doesRayMarchDistantSky: boolean;
    constructor(targetFormats: GPUTextureFormat[], lutRenderer: SkyAtmosphereLutRenderer, bindGroupLayout: GPUBindGroupLayout, pipeline: GPURenderPipeline, config: SkyAtmosphereRasterRendererConfig, isRayMarchPass: boolean);
    protected static makeBlendStates(): {
        single: GPUBlendState;
        dual: GPUBlendState;
    };
    protected static makeExternalBindGroupLayoutEntries(config: SkyAtmosphereRasterRendererConfig): GPUBindGroupLayoutEntry[];
    protected makeExternalBindGroupEntries(depthBuffer: GPUTextureView | GPUTexture): GPUBindGroupEntry[];
    protected abstract makeBindGroup(depthBuffer: GPUTextureView | GPUTexture): GPUBindGroup;
    /**
     * Replaces potentially screen-size dependent external resources (depth buffer) in the internal bind groups.
     *
     * @param depthBuffer The depth buffer to limit the ray marching distance when rendering the sky / atmosphere.
     *                    If this is a textue, a texture view will be created.
     *                    If this is a texture view, it must be allowed to be bound as a `texture<f32>`.
     *                    I.e., if the texture has a depth-stencil format, the texture view must be a `"depth-only"` view.
     */
    onResize(depthBuffer: GPUTextureView | GPUTexture): void;
    /**
     * Renders the sky / atmosphere.
     *
     * @param passEncoder A `GPURenderPassEncoder` or `GPURenderBundleEncoder` to encode the pass with. The encoder is not `end()`ed by this function.
     */
    renderSky(passEncoder: GPURenderPassEncoder | GPURenderBundleEncoder): void;
    private recordBundle;
    updateAtmosphere(atmosphere: Atmosphere): void;
    updateUniforms(uniforms: Uniforms): void;
    renderTransmittanceLut(passEncoder: GPUComputePassEncoder): void;
    renderMultiScatteringLut(passEncoder: GPUComputePassEncoder): void;
    renderConstantLuts(passEncoder: GPUComputePassEncoder, atmosphere?: Atmosphere): void;
    renderSkyViewLut(passEncoder: GPUComputePassEncoder): void;
    renderAerialPerspectiveLut(passEncoder: GPUComputePassEncoder): void;
    renderDynamicLuts(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms): void;
    renderLuts(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms, atmosphere?: Atmosphere, skipDynamicLutRendering?: boolean, forceConstantLutRendering?: boolean, forceSkyViewLutRendering?: boolean): void;
    get resources(): SkyAtmosphereResources;
}
/**
 * A sky / atmosphere renderer that renders the sky based on lookup tables.
 * It uses `GPURenderPipeline`s to render the sky / atmosphere.
 */
export declare class SkyWithLutsRasterRenderer extends SkyRasterRenderer {
    readonly targetFormats: GPUTextureFormat[];
    readonly lutRenderer: SkyAtmosphereLutRenderer;
    protected bindGroupLayout: GPUBindGroupLayout;
    private constructor();
    private static makeBindGroupLayout;
    private static makePipelineDescriptor;
    /**
     * Asynchronously creates a {@link SkyAtmosphereComputeRenderer}.
     *
     * All pipelines used by this renderer are created asynchronously.
     *
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRasterRendererConfig} used to configure internal resources and behavior.
     * @param existingLutRenderer If this is defined, no new internal {@link SkyAtmosphereLutRenderer} will be created. Instead, the existing one is used.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static createAsync(device: GPUDevice, config: SkyAtmosphereRasterRendererConfig, existingLutRenderer?: SkyAtmosphereLutRenderer, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources): Promise<SkyWithLutsRasterRenderer>;
    /**
     * Creates a {@link SkyAtmosphereComputeRenderer}.
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRasterRendererConfig} used to configure internal resources and behavior.
     * @param existingLutRenderer If this is defined, no new internal {@link SkyAtmosphereLutRenderer} will be created. Instead, the existing one is used.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static create(device: GPUDevice, config: SkyAtmosphereRasterRendererConfig, existingLutRenderer?: SkyAtmosphereLutRenderer, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources): SkyWithLutsRasterRenderer;
    protected makeBindGroup(depthBuffer: GPUTextureView | GPUTexture): GPUBindGroup;
    renderLuts(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms, atmosphere?: Atmosphere, skipDynamicLutRendering?: boolean, forceConstantLutRendering?: boolean, forceSkyViewLutRendering?: boolean): void;
}
/**
 * A sky / atmosphere renderer that renders the sky using full-resolution ray marching.
 * It uses `GPURenderPipeline`s to render the sky / atmosphere.
 */
export declare class SkyRayMarchRasterRenderer extends SkyRasterRenderer {
    readonly targetFormats: GPUTextureFormat[];
    readonly lutRenderer: SkyAtmosphereLutRenderer;
    protected bindGroupLayout: GPUBindGroupLayout;
    private constructor();
    private static makeBindGroupLayout;
    private static makePipelineDescriptor;
    /**
     * Asynchronously creates a {@link SkyAtmosphereComputeRenderer}.
     *
     * All pipelines used by this renderer are created asynchronously.
     *
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRasterRendererConfig} used to configure internal resources and behavior.
     * @param existingLutRenderer If this is defined, no new internal {@link SkyAtmosphereLutRenderer} will be created. Instead, the existing one is used.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static createAsync(device: GPUDevice, config: SkyAtmosphereRasterRendererConfig, existingLutRenderer?: SkyAtmosphereLutRenderer, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources): Promise<SkyRayMarchRasterRenderer>;
    /**
     * Creates a {@link SkyAtmosphereComputeRenderer}.
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRasterRendererConfig} used to configure internal resources and behavior.
     * @param existingLutRenderer If this is defined, no new internal {@link SkyAtmosphereLutRenderer} will be created. Instead, the existing one is used.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static create(device: GPUDevice, config: SkyAtmosphereRasterRendererConfig, existingLutRenderer?: SkyAtmosphereLutRenderer, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources): SkyRayMarchRasterRenderer;
    protected makeBindGroup(depthBuffer: GPUTextureView | GPUTexture): GPUBindGroup;
    renderLuts(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms, atmosphere?: Atmosphere, skipDynamicLutRendering?: boolean, forceConstantLutRendering?: boolean, forceSkyViewLutRendering?: boolean): void;
    get rayMarchDistantSky(): boolean;
}
/**
 * A sky / atmosphere renderer that uses `GPURenderPipeline`s to render the sky / atmosphere.
 */
export declare class SkyAtmosphereRasterRenderer implements SkyAtmosphereRenderer {
    readonly lutRenderer: SkyAtmosphereLutRenderer;
    readonly withLutsRenderer: SkyWithLutsRasterRenderer;
    readonly rayMarchRenderer: SkyRayMarchRasterRenderer;
    defaultToFullResolutionRayMarch: boolean;
    private constructor();
    /**
     * Asynchronously creates a {@link SkyAtmosphereRasterRenderer}.
     *
     * All pipelines used by this renderer are created asynchronously.
     *
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingLutRenderer If this is defined, no new internal {@link SkyAtmosphereLutRenderer} will be created. Instead, the existing one is used.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static createAsync(device: GPUDevice, config: SkyAtmosphereRasterRendererConfig, existingLutRenderer?: SkyAtmosphereLutRenderer, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources): Promise<SkyAtmosphereRasterRenderer>;
    /**
     * Creates a {@link SkyAtmosphereRasterRenderer}.
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingLutRenderer If this is defined, no new internal {@link SkyAtmosphereLutRenderer} will be created. Instead, the existing one is used.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static create(device: GPUDevice, config: SkyAtmosphereRasterRendererConfig, existingLutRenderer?: SkyAtmosphereLutRenderer, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources): SkyAtmosphereRasterRenderer;
    /**
     * Replaces potentially screen-size dependent external resources (depth buffer) in the internal bind groups.
     *
     * @param depthBuffer The depth buffer to limit the ray marching distance when rendering the sky / atmosphere.
     *                    If this is a textue, a texture view will be created.
     *                    If this is a texture view, it must be allowed to be bound as a `texture<f32>`.
     *                    I.e., if the texture has a depth-stencil format, the texture view must be a `"depth-only"` view.
     */
    onResize(depthBuffer: GPUTextureView | GPUTexture): void;
    /**
     * Renders the sky / atmosphere using precomputed lookup tables.
     *
     * Requires the sky view and aerial perspective lookup tables to be initialized.
     * To initialize these lookup tables, call {@link renderDynamicLuts}.
     *
     * @param passEncoder A `GPURenderPassEncoder` or `GPURenderBundleEncoder` to encode the pass with. The encoder is not `end()`ed by this function.
     *
     * @see {@link renderDynamicLuts}: To initialize the lookup tables required, call this function.
     */
    renderSkyWithLuts(passEncoder: GPURenderPassEncoder | GPURenderBundleEncoder): void;
    /**
     * Renders the sky / atmosphere using full-resolution ray marching.
     *
     * Requires the transmittance and multiple scattering lookup tables to be initialized.
     * Either initialize these lookup tables in the constructor using {@link SkyAtmosphereRendererConfig.initializeConstantLuts}, or call {@link renderConstantLuts}.
     *
     * @param passEncoder A `GPURenderPassEncoder` or `GPURenderBundleEncoder` to encode the pass with. The encoder is not `end()`ed by this function.
     *
     * @see {@link renderConstantLuts}: To initialize the lookup tables required, call this function.
     */
    renderSkyRaymarching(passEncoder: GPURenderPassEncoder | GPURenderBundleEncoder): void;
    /**
     * Renders the sky / atmosphere using either lookup tables or full-resolution ray marching, as well as all look up tables required by the respective approach.
     *
     * @param passEncoder A `GPURenderPassEncoder` or `GPURenderBundleEncoder` to encode the sky / atmosphere rendering pass with. The encoder is not `end()`ed by this function.
     * @param useFullResolutionRayMarch If this is true, full-resolution ray marching will be used to render the sky / atmosphere. Defaults to {@link defaultToFullResolutionRayMarch}.
     *
     * @see {@link renderSkyWithLuts}: Renders the sky with lookup tables.
     * @see {@link renderSkyRaymarching}: Renders the sky with full-resolution ray marching.
     */
    renderSky(passEncoder: GPURenderPassEncoder | GPURenderBundleEncoder, useFullResolutionRayMarch?: boolean): void;
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
