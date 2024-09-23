/// <reference types="dist" />
import { Absorption, AbsorptionLayer0, AbsorptionLayer1, Atmosphere, makeEarthAtmosphere, Mie, Rayleigh } from './atmosphere.js';
import { AerialPerspectiveLutConfig, AtmosphereLightsConfig, ComputeBackBufferConfig, ComputeRenderTargetConfig, CustomUniformsSourceConfig, DepthBufferConfig, FullResolutionRayMarchConfig, MieHgDPhaseConfig, MultiScatteringLutConfig, ShadowConfig, SkyRendererComputeConfig, SkyAtmosphereLutConfig, SkyAtmosphereRendererConfig, SkyAtmosphereComputeRendererConfig, SkyRendererConfigBase, SkyRendererRasterConfig, SkyAtmosphereRasterRendererConfig, SkyViewLutConfig, TransmittanceLutConfig } from './config.js';
import { Camera, AtmosphereLight, Uniforms } from './uniforms.js';
import { atmosphereToFloatArray, ATMOSPHERE_BUFFER_SIZE, uniformsToFloatArray, UNIFORMS_BUFFER_SIZE, SkyAtmosphereResources } from './resources.js';
import { SkyAtmospherePipelines as SkyAtmosphereLutPipelines } from './pipelines.js';
import { ComputePass, LookUpTable, RenderPass } from './util.js';
export { Absorption, AbsorptionLayer0, AbsorptionLayer1, Atmosphere, makeEarthAtmosphere, Mie, Rayleigh, };
export { AerialPerspectiveLutConfig, AtmosphereLightsConfig, ComputeBackBufferConfig, ComputeRenderTargetConfig, CustomUniformsSourceConfig, DepthBufferConfig, FullResolutionRayMarchConfig, MieHgDPhaseConfig, MultiScatteringLutConfig, ShadowConfig, SkyRendererComputeConfig, SkyAtmosphereLutConfig, SkyAtmosphereRendererConfig, SkyAtmosphereComputeRendererConfig, SkyRendererConfigBase, SkyRendererRasterConfig, SkyAtmosphereRasterRendererConfig, SkyViewLutConfig, TransmittanceLutConfig, };
export { Camera, AtmosphereLight, Uniforms, };
export { atmosphereToFloatArray, ATMOSPHERE_BUFFER_SIZE, uniformsToFloatArray, UNIFORMS_BUFFER_SIZE, SkyAtmosphereResources, };
export { ComputePass, LookUpTable, RenderPass, };
export declare class SkyAtmosphereLutRenderer {
    readonly resources: SkyAtmosphereResources;
    readonly lutPipelines: SkyAtmosphereLutPipelines;
    defaultToFullResolutionRayMarch: boolean;
    readonly usesCustomUniforms: boolean;
    protected transmittanceLutPass: ComputePass;
    protected multiScatteringLutPass: ComputePass;
    protected skyViewLutPass: ComputePass;
    protected aerialPerspectiveLutPass: ComputePass;
    protected constructor(lutRenderer?: SkyAtmosphereLutRenderer, resources?: SkyAtmosphereResources, skyAtmospherePipelines?: SkyAtmosphereLutPipelines, defaultToPerPixelRayMarch?: boolean, usesCustomUniforms?: boolean, transmittanceLutPass?: ComputePass, multiScatteringLutPass?: ComputePass, skyViewLutPass?: ComputePass, aerialPerspectiveLutPass?: ComputePass);
    /**
     * Creates a {@link SkyAtmosphereLutRenderer}.
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static create(device: GPUDevice, config: SkyAtmosphereRendererConfig, existingPipelines?: SkyAtmosphereLutPipelines, existingResources?: SkyAtmosphereResources): SkyAtmosphereLutRenderer;
    /**
     * Asynchronously creates a {@link SkyAtmosphereLutRenderer}.
     *
     * All pipelines used by this renderer are created asynchronously.
     *
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static createAsync(device: GPUDevice, config: SkyAtmosphereRendererConfig, existingPipelines?: SkyAtmosphereLutPipelines, existingResources?: SkyAtmosphereResources): Promise<SkyAtmosphereLutRenderer>;
    /**
     * Updates the renderer's internal uniform buffer containing the {@link Atmosphere} parameters as well as its host-side copy of {@link Atmosphere} parameters.
     * @param atmosphere The new {@link Atmosphere} to override the current parameters.
     *
     * @see {@link SkyAtmosphereResources.updateAtmosphere}: Updates the host-side {@link Atmosphere} parameters as well as the corresponding uniform buffer.
     */
    updateAtmosphere(atmosphere: Atmosphere): void;
    /**
     * Updates the renderer's internal uniform buffer containing the {@link Uniforms} as well as its host-side copy of {@link Uniforms}.
     * @param uniforms The new {@link Uniforms} to override the current parameters.
     *
     * If custom uniform buffers are used, this does nothing (see {@link CustomUniformsSourceConfig}).
     *
     * @see {@link SkyAtmosphereResources.updateUniforms}: Update the {@link Uniforms} uniform buffers.
     */
    updateUniforms(uniforms: Uniforms): void;
    /**
     * Renders the transmittance lookup table.
     *
     * To produce meaningful results, this requires the internal uniform buffer containing the {@link Atmosphere} parameters to hold valid data.
     * Call {@link updateAtmosphere} to ensure this is the case.
     *
     * Since the transmittance lookup table is not view or light souce dependent, this only needs to be called if the {@link Atmosphere} parameters change.
     *
     * @param passEncoder Used to encode rendering of the lookup table. The encoder is not `end()`ed by this function.
     *
     * @see {@link updateAtmosphere}: To write {@link Atmosphere} parameters to the internal uniform buffer, call this function.
     */
    renderTransmittanceLut(passEncoder: GPUComputePassEncoder): void;
    /**
     * Renders the multiple scattering lookup table.
     *
     * To produce meaningful results, this requires the internal uniform buffer containing the {@link Atmosphere} parameters to hold valid data.
     * Call {@link updateAtmosphere} to ensure this is the case.
     *
     * Since the multiple scattering lookup table is not view or light souce dependent, this only needs to be called if the {@link Atmosphere} parameters change.
     *
     * @param passEncoder Used to encode rendering of the lookup table. The encoder is not `end()`ed by this function.
     *
     * @see {@link updateAtmosphere}: To write {@link Atmosphere} parameters to the internal uniform buffer, call this function.
     */
    renderMultiScatteringLut(passEncoder: GPUComputePassEncoder): void;
    /**
     * Renders the transmittance and multiple scattering lookup tables.
     *
     * To produce meaningful results, this requires the internal uniform buffer containing the {@link Atmosphere} parameters to hold valid data.
     * Use the {@link atmosphere} parameter to implicitly update the {@link Atmosphere} parameters or call {@link updateAtmosphere} to ensure this is the case.
     *
     * Since the transmittance and multiple scattering lookup tables are not view or light souce dependent, this only needs to be called if the {@link Atmosphere} parameters change.
     *
     * @param passEncoder Used to encode rendering of the lookup tables. The encoder is not `end()`ed by this function.
     * @param atmosphere If this is defined, {@link updateAtmosphere} is called before rendering the lookup tables.
     *
     * @see {@link updateAtmosphere}: Updates the {@link Atmosphere} parameters.
     * @see {@link renderTransmittanceLut}: Renders the transmittance lookup table.
     * @see {@link renderMultiScatteringLut}: Renders the multiple scattering lookup table.
     */
    renderConstantLuts(passEncoder: GPUComputePassEncoder, atmosphere?: Atmosphere): void;
    /**
     * Renders the sky view table.
     *
     * To produce meaningful results, this requires the transmittance and multiple scattering lookup tables, as well as the uniform buffers containing the {@link Atmosphere} and {@link Uniforms} parameters to hold valid data.
     * Call {@link renderConstantLuts} and {@link updateUniforms} to ensure this is the case.
     *
     * @param passEncoder Used to encode rendering of the lookup table. The encoder is not `end()`ed by this function.
     *
     * @see {@link renderConstantLuts}: To initialize the transmittance and multiple scattering lookup tables, as well as the internal uniform buffer storing the {@link Atmosphere} parameters, call this function.
     * @see {@link updateUniforms}: To write {@link Uniforms} to the internal uniform buffer, call this function.
     */
    renderSkyViewLut(passEncoder: GPUComputePassEncoder): void;
    /**
     * Renders the aerial perspective lookup table.
     *
     * To produce meaningful results, this requires the transmittance and multiple scattering lookup tables, as well as the uniform buffers containing the {@link Atmosphere} and {@link Uniforms} parameters to hold valid data.
     * Call {@link renderConstantLuts} and {@link updateUniforms} to ensure this is the case.
     *
     * If (a) user-defined shadow map(s) is used (see {@link SkyAtmosphereRendererConfig.shadow}), make sure to encode any updates of the shadow map(s) before encoding this pass.
     *
     * @param passEncoder Used to encode rendering of the lookup table. The encoder is not `end()`ed by this function.
     *
     * @see {@link renderConstantLuts}: To initialize the transmittance and multiple scattering lookup tables, as well as the internal uniform buffer storing the {@link Atmosphere} parameters, call this function.
     * @see {@link updateUniforms}: To write {@link Uniforms} to the internal uniform buffer, call this function.
     */
    renderAerialPerspectiveLut(passEncoder: GPUComputePassEncoder): void;
    /**
     * Renders the sky view and aerial perspective lookup tables.
     *
     * To produce meaningful results, this requires the transmittance and multiple scattering lookup tables, as well as the uniform buffers containing the {@link Atmosphere} and {@link Uniforms} parameters to hold valid data.
     * Call {@link renderConstantLuts} and {@link updateUniforms} to ensure this is the case.
     *
     * If (a) user-defined shadow map(s) is used (see {@link SkyAtmosphereRendererConfig.shadow}), make sure to encode any updates of the shadow map(s) before encoding this pass.
     *
     * @param passEncoder Used to encode rendering of the lookup tables. The encoder is not `end()`ed by this function.
     * @param uniforms If this is defined, {@link updateUniforms} is called before rendering the lookup tables.
     *
     * @see {@link renderConstantLuts}: To initialize the transmittance and multiple scattering lookup tables, as well as the internal uniform buffer storing the {@link Atmosphere} parameters, call this function.
     * @see {@link updateUniforms}: Updates the internal {@link Uniforms} uniform buffer.
     * @see {@link renderSkyViewLut}: Renders the sky view lookup table.
     * @see {@link renderAerialPerspectiveLut}: Renders the aerial perspective lookup table.
     */
    renderDynamicLuts(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms): void;
    /**
     * Renders the lookup tables required for rendering the sky / atmosphere.
     *
     * To initialize or update the transmittance and multiple scattering lookup tables, pass new {@link Atmosphere} paramters to this function or use the `forceConstantLutRendering` parameter.
     *
     * @param passEncoder A `GPUComputePassEncoder` to encode passes with. The encoder is not `end()`ed by this function.
     * @param uniforms {@link Uniforms} to use for this frame. If this is given, the internal uniform buffer will be updated using {@link updateUniforms}.
     * @param atmosphere {@link Atmosphere} parameters to use for this frame. If this is given, the internal uniform buffer storing the {@link Atmosphere} parameters will be updated and the transmittance and multiple scattering lookup tables will be rendered.
     * @param useFullResolutionRayMarch If this is true, the sky view and aerial perspective lookup tables will not be rendered. Defaults to {@link defaultToFullResolutionRayMarch}.
     * @param forceConstantLutRendering If this is true, the transmittance and multiple scattering lookup tables will be rendered regardless of whether the `atmosphere` parameter is `undefined` or not.
     * @param forceSkyViewLutRendering If this is true, the sky view lookup table will be rendered, even if {@link useFullResolutionRayMarch} is true. Defaults to false.
     *
     * @see {@link renderConstantLuts}: Renders the lookup tables that are constant for a given {@link Atmosphere}.
     * @see {@link updateUniforms}: Updates the internal {@link Uniforms} uniform buffer.
     * @see {@link renderDynamicLuts}: Renders the view-dependent lookup tables.
     * @see {@link renderSkyViewLut}: Renders the sky view lookup table.
     */
    renderLuts(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms, atmosphere?: Atmosphere, useFullResolutionRayMarch?: boolean, forceConstantLutRendering?: boolean, forceSkyViewLutRendering?: boolean): void;
}
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
/**
 * A {@link SkyAtmosphereLutRenderer} that uses `GPUComputePipeline`s to render the sky / atmosphere.
 */
export declare class SkyAtmosphereComputeRenderer extends SkyAtmosphereLutRenderer {
    private withLutsLayout;
    private rayMarchLayout;
    private rayMarchDistantSky;
    private withLutsPass;
    private rayMarchPass;
    private constructor();
    private static makeBindGroupLayouts;
    private static makeWithLutsPiplelineDescriptor;
    private static makeRayMarchPipelineDescriptor;
    /**
     * Asynchronously creates a {@link SkyAtmosphereComputeRenderer}.
     *
     * All pipelines used by this renderer are created asynchronously.
     *
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static createAsync(device: GPUDevice, config: SkyAtmosphereComputeRendererConfig, existingPipelines?: SkyAtmosphereLutPipelines, existingResources?: SkyAtmosphereResources): Promise<SkyAtmosphereComputeRenderer>;
    /**
     * Creates a {@link SkyAtmosphereComputeRenderer}.
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static create(device: GPUDevice, config: SkyAtmosphereComputeRendererConfig, existingPipelines?: SkyAtmosphereLutPipelines, existingResources?: SkyAtmosphereResources): SkyAtmosphereComputeRenderer;
    private makeBindGroups;
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
}
/**
 * A {@link SkyAtmosphereLutRenderer} that uses `GPURenderPipeline`s to render the sky / atmosphere.
 */
export declare class SkyAtmosphereRasterRenderer extends SkyAtmosphereLutRenderer {
    private withLutsLayout;
    private rayMarchLayout;
    private withLutsTargetFormats;
    private rayMarchTargetFormats;
    private rayMarchDistantSky;
    private withLutsPass;
    private withLutsBundle?;
    private rayMarchPass;
    private rayMarchBundle?;
    private constructor();
    private static makeBindGroupLayouts;
    private static makeBlendStates;
    private static makeWithLutsPiplelineDescriptor;
    private static makeRayMarchPipelineDescriptor;
    /**
     * Asynchronously creates a {@link SkyAtmosphereRasterRenderer}.
     *
     * All pipelines used by this renderer are created asynchronously.
     *
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static createAsync(device: GPUDevice, config: SkyAtmosphereRasterRendererConfig, existingPipelines?: SkyAtmosphereLutPipelines, existingResources?: SkyAtmosphereResources): Promise<SkyAtmosphereRasterRenderer>;
    /**
     * Creates a {@link SkyAtmosphereRasterRenderer}.
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static create(device: GPUDevice, config: SkyAtmosphereRasterRendererConfig, existingPipelines?: SkyAtmosphereLutPipelines, existingResources?: SkyAtmosphereResources): SkyAtmosphereRasterRenderer;
    private makeBindGroups;
    private recordBundles;
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
    /**
     * Renders the lookup tables required for rendering the sky / atmosphere.
     *
     * To initialize or update the transmittance and multiple scattering lookup tables, pass new {@link Atmosphere} paramters to this function or use the `forceConstantLutRendering` parameter.
     *
     * @param passEncoder A `GPUComputePassEncoder` to encode passes with. The encoder is not `end()`ed by this function.
     * @param uniforms {@link Uniforms} to use for this frame. If this is given, the internal uniform buffer will be updated using {@link updateUniforms}.
     * @param atmosphere {@link Atmosphere} parameters to use for this frame. If this is given, the internal uniform buffer storing the {@link Atmosphere} parameters will be updated and the transmittance and multiple scattering lookup tables will be rendered.
     * @param useFullResolutionRayMarch If this is true, the sky view and aerial perspective lookup tables will not be rendered. Defaults to {@link defaultToFullResolutionRayMarch}.
     * @param forceConstantLutRendering If this is true, the transmittance and multiple scattering lookup tables will be rendered regardless of whether the `atmosphere` parameter is `undefined` or not.
     * @param forceSkyViewLutRendering If this is true, the sky view lookup table will be rendered, even if {@link useFullResolutionRayMarch} is true. Defaults to !{@link rayMarchDistantSky}.
     */
    renderLuts(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms, atmosphere?: Atmosphere, useFullResolutionRayMarch?: boolean, forceConstantLutRendering?: boolean, forceSkyViewLutRendering?: boolean): void;
}
