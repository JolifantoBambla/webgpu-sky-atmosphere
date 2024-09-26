/*
 * Copyright (c) 2024 Lukas Herzberger
 * SPDX-License-Identifier: MIT
 */

import { Atmosphere } from './atmosphere.js';
import { SkyAtmosphereComputeRendererConfig } from './config.js';
import { SkyAtmosphereRenderer, SkyAtmosphereLutRenderer } from './lut-renderer.js';
import { SkyAtmospherePipelines } from './pipelines.js';
import { SkyAtmosphereResources } from './resources.js';
import { makeRenderSkyLutAndRaymarchingShaderCode, makeRenderSkyRaymarchingShaderCode, makeRenderSkyWithLutsShaderCode } from './shaders.js';
import { makeRayMarchBindGroup, makeRayMarchBindGroupLayout, makeRayMarchConstantsBase, makeWithLutsBindGroup, makeWithLutsBindGroupLayout, makeWithLutsConstants } from './sky-renderer-utils.js';
import { Uniforms } from './uniforms.js';
import { ComputePass } from './util.js';

export interface SkyAtmosphereComputeRendererResizeConfig {
    /**
     * The back buffer texture to use as back ground when rendering the sky / atmosphere using a GPUComputePipeline.
     *
     * If this is a texture, a texture view will be created.
     *
     * Should have the same size as the other textures.
     */
    backBuffer: GPUTextureView | GPUTexture,

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
    depthBuffer: GPUTextureView | GPUTexture,

    /**
     * The render target to render into when using a GPUComputePipeline to render the sky / atmosphere.
     *
     * If this is a texture, a texture view will be created.
     *
     * Should have the same size as the other textures.
     */
    renderTarget: GPUTextureView | GPUTexture,

    /**
     * The new size of the textures.
     *
     * If this is undefined, the new size is determined from the given resources, i.e., at least one of {@link backBuffer}, {@link depthBuffer}, and {@link renderTarget} must be a `GPUTexture`.
     */
    size?: [number, number],
}

abstract class SkyComputeRenderer implements SkyAtmosphereRenderer {
    private pass: ComputePass;
    protected doesRayMarchDistantSky: boolean;

    constructor(
        protected lutRenderer: SkyAtmosphereLutRenderer,
        protected bindGroupLayout: GPUBindGroupLayout,
        pipeline: GPUComputePipeline,
        config: SkyAtmosphereComputeRendererConfig,
        isRayMarchPass: boolean,
    ) {
        this.doesRayMarchDistantSky = config.skyRenderer.rayMarch?.rayMarchDistantSky ?? true;

        const bindGroup = this.makeBindGroup({
            depthBuffer: config.skyRenderer.depthBuffer.view ?? config.skyRenderer.depthBuffer.texture,
            backBuffer: config.skyRenderer.backBuffer.view ?? config.skyRenderer.backBuffer.texture,
            renderTarget: config.skyRenderer.renderTarget.view ?? config.skyRenderer.renderTarget.texture,
        });

        const dispatchDimensions: [number, number, number] = [
            Math.ceil(config.skyRenderer.renderTarget.texture.width / 16.0),
            Math.ceil(config.skyRenderer.renderTarget.texture.height / 16.0),
            1,
        ];

        this.pass = new ComputePass(
            pipeline,
            [
                bindGroup,
                ...(isRayMarchPass ? config.shadow?.bindGroups ?? [] : []),
                ...(config.customUniformsSource?.bindGroups ?? []),
            ],
            dispatchDimensions,
        );
    }

    protected static makeExternalBindGroupLayoutEntries(config: SkyAtmosphereComputeRendererConfig): GPUBindGroupLayoutEntry[] {
        return [
            {
                binding: 5,
                visibility: GPUShaderStage.COMPUTE,
                texture: {
                    sampleType: 'unfilterable-float',
                    viewDimension: config.skyRenderer.depthBuffer.texture.dimension,
                    multisampled: false,
                },
            },
            {
                binding: 6,
                visibility: GPUShaderStage.COMPUTE,
                texture: {
                    sampleType: 'unfilterable-float',
                    viewDimension: config.skyRenderer.backBuffer.texture.dimension,
                    multisampled: false,
                },
            },
            {
                binding: 7,
                visibility: GPUShaderStage.COMPUTE,
                storageTexture: {
                    access: 'write-only',
                    format: config.skyRenderer.renderTarget.texture.format,
                    viewDimension: config.skyRenderer.renderTarget.texture.dimension,
                },
            },
        ];

    }

    protected makeExternalBindGroupEntries(config: SkyAtmosphereComputeRendererResizeConfig): GPUBindGroupEntry[] {
        return [
            {
                binding: 5,
                resource: config.depthBuffer instanceof GPUTextureView ? config.depthBuffer : config.depthBuffer.createView(config.depthBuffer.format.includes('depth') ? {
                    aspect: 'depth-only',
                } : {}),
            },
            {
                binding: 6,
                resource: config.backBuffer instanceof GPUTextureView ? config.backBuffer : config.backBuffer.createView(),
            },
            {
                binding: 7,
                resource: config.renderTarget instanceof GPUTextureView ? config.renderTarget : config.renderTarget.createView(),
            },
        ];
    }

    protected abstract makeBindGroup(config: SkyAtmosphereComputeRendererResizeConfig): GPUBindGroup;

    /**
     * Replaces potentially screen-size dependent external resources (back buffer, depth buffer, and render target) in the internal bind groups.
     *
     * @param config Configuration of external resources.
     */
    public onResize(config: SkyAtmosphereComputeRendererResizeConfig) {
        let size = config.size ?? [-1, -1];
        if (size[0] < 0) {
            if (config.backBuffer instanceof GPUTexture) {
                size = [config.backBuffer.width, config.backBuffer.height];
            }
            if (config.depthBuffer instanceof GPUTexture) {
                size = [config.depthBuffer.width, config.depthBuffer.height];
            }
            if (config.renderTarget instanceof GPUTexture) {
                size = [config.renderTarget.width, config.renderTarget.height];
            }
        }
        if (size[0] < 0 || size[1] < 0) {
            throw new Error(`[SkyAtmosphereComputeRenderer::onResize]: could not determine new size from config`);
        }
        this.pass.replaceBindGroup(0, this.makeBindGroup(config));
        this.pass.replaceDispatchDimensions([
            Math.ceil(size[0] / 16.0),
            Math.ceil(size[1] / 16.0),
            1,
        ]);
    }

    /**
     * Renders the sky / atmosphere.
     *
     * @param passEncoder A `GPUComputePassEncoder` to encode the pass with. Can be the same encoder used to initialize lookup tables required. The encoder is not `end()`ed by this function.
     */
    public renderSky(passEncoder: GPUComputePassEncoder) {
        this.pass.encode(passEncoder);
    }

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
    public abstract renderLutsAndSky(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms, atmosphere?: Atmosphere, forceConstantLutRendering?: boolean): void;

    public updateAtmosphere(atmosphere: Atmosphere): void {
        this.lutRenderer.updateAtmosphere(atmosphere);
    }

    public updateUniforms(uniforms: Uniforms): void {
        this.lutRenderer.updateUniforms(uniforms);
    }

    public renderTransmittanceLut(passEncoder: GPUComputePassEncoder): void {
        this.lutRenderer.renderTransmittanceLut(passEncoder);
    }

    public renderMultiScatteringLut(passEncoder: GPUComputePassEncoder): void {
        this.lutRenderer.renderMultiScatteringLut(passEncoder);
    }

    public renderConstantLuts(passEncoder: GPUComputePassEncoder, atmosphere?: Atmosphere): void {
        this.lutRenderer.renderConstantLuts(passEncoder, atmosphere);
    }

    public renderSkyViewLut(passEncoder: GPUComputePassEncoder): void {
        this.lutRenderer.renderSkyViewLut(passEncoder);
    }

    public renderAerialPerspectiveLut(passEncoder: GPUComputePassEncoder): void {
        this.lutRenderer.renderAerialPerspectiveLut(passEncoder);
    }

    public renderDynamicLuts(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms): void {
        this.lutRenderer.renderDynamicLuts(passEncoder, uniforms);
    }

    public renderLuts(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms, atmosphere?: Atmosphere, useFullResolutionRayMarch?: boolean, forceConstantLutRendering?: boolean, forceSkyViewLutRendering?: boolean): void {
        this.lutRenderer.renderLuts(passEncoder, uniforms, atmosphere, useFullResolutionRayMarch, forceConstantLutRendering, forceSkyViewLutRendering);
    }

    get resources(): SkyAtmosphereResources {
        return this.lutRenderer.resources;
    }
}

/**
 * A sky / atmosphere renderer that renders the sky based on lookup tables.
 * It uses `GPUComputePipeline`s to render the sky / atmosphere.
 */
export class SkyWithLutsComputeRenderer extends SkyComputeRenderer {
    private constructor(
        lutRenderer: SkyAtmosphereLutRenderer,
        bindGroupLayout: GPUBindGroupLayout,
        pipeline: GPUComputePipeline,
        config: SkyAtmosphereComputeRendererConfig,
    ) {
        super(lutRenderer, bindGroupLayout, pipeline, config, false);
    }

    private static makeBindGroupLayout(device: GPUDevice, config: SkyAtmosphereComputeRendererConfig, resources: SkyAtmosphereResources): GPUBindGroupLayout {
        return makeWithLutsBindGroupLayout(device, config, this.makeExternalBindGroupLayoutEntries(config), resources, GPUShaderStage.COMPUTE);
    }

    private static makeWithLutsPiplelineDescriptor(device: GPUDevice, config: SkyAtmosphereComputeRendererConfig, lutRenderer: SkyAtmosphereLutRenderer, renderSkyWithLutsBindGroupLayout: GPUBindGroupLayout): GPUComputePipelineDescriptor {
        return {
            label: `Render sky with LUTs pipeline [${lutRenderer.resources.label}]`,
            layout: device.createPipelineLayout({
                label: `Render sky with LUTs pipeline layout [${lutRenderer.resources.label}]`,
                bindGroupLayouts: [
                    renderSkyWithLutsBindGroupLayout,
                    ...(config.customUniformsSource?.bindGroupLayouts ?? []),
                ],
            }),
            compute: {
                module: device.createShaderModule({
                    code: makeRenderSkyWithLutsShaderCode(config.skyRenderer.renderTarget.texture.format, config.customUniformsSource?.wgslCode),
                }),
                entryPoint: 'render_sky_atmosphere',
                constants: makeWithLutsConstants(config, lutRenderer),
            },
        };
    }

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
    static async createAsync(device: GPUDevice, config: SkyAtmosphereComputeRendererConfig, existingLutRenderer?: SkyAtmosphereLutRenderer, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources): Promise<SkyWithLutsComputeRenderer> {
        const lutRenderer = existingLutRenderer ?? await SkyAtmosphereLutRenderer.createAsync(device, config, existingPipelines, existingResources);
        const bindGroupLayout = this.makeBindGroupLayout(device, config, lutRenderer.resources);
        const pipeline = await device.createComputePipelineAsync(this.makeWithLutsPiplelineDescriptor(device, config, lutRenderer, bindGroupLayout));
        return new SkyWithLutsComputeRenderer(
            lutRenderer,
            bindGroupLayout,
            pipeline,
            config,
        );
    }

    /**
     * Creates a {@link SkyAtmosphereComputeRenderer}.
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingLutRenderer If this is defined, no new internal {@link SkyAtmosphereLutRenderer} will be created. Instead, the existing one is used.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static create(device: GPUDevice, config: SkyAtmosphereComputeRendererConfig, existingLutRenderer?: SkyAtmosphereLutRenderer, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources): SkyWithLutsComputeRenderer {
        const lutRenderer = existingLutRenderer ?? SkyAtmosphereLutRenderer.create(device, config, existingPipelines, existingResources);
        const bindGroupLayout = this.makeBindGroupLayout(device, config, lutRenderer.resources);
        const pipeline = device.createComputePipeline(this.makeWithLutsPiplelineDescriptor(device, config, lutRenderer, bindGroupLayout));
        return new SkyWithLutsComputeRenderer(
            lutRenderer,
            bindGroupLayout,
            pipeline,
            config,
        );
    }

    protected makeBindGroup(config: SkyAtmosphereComputeRendererResizeConfig): GPUBindGroup {
        return makeWithLutsBindGroup(this.lutRenderer.resources, this.bindGroupLayout, this.lutRenderer.usesCustomUniforms, this.makeExternalBindGroupEntries(config));
    }

    public renderLutsAndSky(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms, atmosphere?: Atmosphere, forceConstantLutRendering?: boolean) {
        this.lutRenderer.renderLuts(passEncoder, uniforms, atmosphere, false, forceConstantLutRendering, false);
        this.renderSky(passEncoder);
    }
}

/**
 * A sky / atmosphere renderer that renders the sky using full-resolution ray marching.
 * It uses `GPUComputePipeline`s to render the sky / atmosphere.
 */
export class SkyRayMarchComputeRenderer extends SkyComputeRenderer {
    private constructor(
        lutRenderer: SkyAtmosphereLutRenderer,
        bindGroupLayout: GPUBindGroupLayout,
        pipeline: GPUComputePipeline,
        config: SkyAtmosphereComputeRendererConfig,
    ) {
        super(lutRenderer, bindGroupLayout, pipeline, config, true);
    }

    private static makeBindGroupLayout(device: GPUDevice, config: SkyAtmosphereComputeRendererConfig, resources: SkyAtmosphereResources, rayMarchDistantSky: boolean): GPUBindGroupLayout {
        return makeRayMarchBindGroupLayout(device, config, this.makeExternalBindGroupLayoutEntries(config), resources, rayMarchDistantSky, GPUShaderStage.COMPUTE);
    }

    private static makeRayMarchPipelineDescriptor(device: GPUDevice, config: SkyAtmosphereComputeRendererConfig, lutRenderer: SkyAtmosphereLutRenderer, renderSkyRaymarchingBindGroupLayout: GPUBindGroupLayout, rayMarchDistantSky: boolean): GPUComputePipelineDescriptor {
        const constants: Record<string, GPUPipelineConstantValue> = {
            ...makeRayMarchConstantsBase(config, lutRenderer, rayMarchDistantSky),
            USE_COLORED_TRANSMISSION: Number(config.skyRenderer.rayMarch?.useColoredTransmittance ?? true),
        };

        const module = device.createShaderModule({
            code: (rayMarchDistantSky ? makeRenderSkyRaymarchingShaderCode : makeRenderSkyLutAndRaymarchingShaderCode)(config.skyRenderer.renderTarget.texture.format, config.shadow?.wgslCode, config.customUniformsSource?.wgslCode, config.mieHgDrainePhase?.constantDropletDiameter),
        });

        return {
            label: `Render sky raymarching pipeline [${lutRenderer.resources.label}]`,
            layout: device.createPipelineLayout({
                label: 'Render sky raymarching pipeline layout',
                bindGroupLayouts: [
                    renderSkyRaymarchingBindGroupLayout,
                    ...(config.shadow?.bindGroupLayouts ?? []),
                    ...(config.customUniformsSource?.bindGroupLayouts ?? []),
                ],
            }),
            compute: {
                module,
                entryPoint: 'render_sky_atmosphere',
                constants,
            },
        };
    }

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
    static async createAsync(device: GPUDevice, config: SkyAtmosphereComputeRendererConfig, existingLutRenderer?: SkyAtmosphereLutRenderer, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources): Promise<SkyRayMarchComputeRenderer> {
        const rayMarchDistantSky = config.skyRenderer.rayMarch?.rayMarchDistantSky ?? true;
        const lutRenderer = existingLutRenderer ?? await SkyAtmosphereLutRenderer.createAsync(device, config, existingPipelines, existingResources);
        const bindGroupLayout = this.makeBindGroupLayout(device, config, lutRenderer.resources, rayMarchDistantSky);
        const pipelines = await device.createComputePipelineAsync(this.makeRayMarchPipelineDescriptor(device, config, lutRenderer, bindGroupLayout, rayMarchDistantSky));
        return new SkyRayMarchComputeRenderer(
            lutRenderer,
            bindGroupLayout,
            pipelines,
            config,
        );
    }

    /**
     * Creates a {@link SkyAtmosphereComputeRenderer}.
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingLutRenderer If this is defined, no new internal {@link SkyAtmosphereLutRenderer} will be created. Instead, the existing one is used.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static create(device: GPUDevice, config: SkyAtmosphereComputeRendererConfig, existingLutRenderer?: SkyAtmosphereLutRenderer, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources): SkyRayMarchComputeRenderer {
        const rayMarchDistantSky = config.skyRenderer.rayMarch?.rayMarchDistantSky ?? true;
        const lutRenderer = existingLutRenderer ?? SkyAtmosphereLutRenderer.create(device, config, existingPipelines, existingResources);
        const bindGroupLayout = this.makeBindGroupLayout(device, config, lutRenderer.resources, rayMarchDistantSky);
        const pipelines = device.createComputePipeline(this.makeRayMarchPipelineDescriptor(device, config, lutRenderer, bindGroupLayout, rayMarchDistantSky));
        return new SkyRayMarchComputeRenderer(
            lutRenderer,
            bindGroupLayout,
            pipelines,
            config,
        );
    }

    protected makeBindGroup(config: SkyAtmosphereComputeRendererResizeConfig): GPUBindGroup {
        return makeRayMarchBindGroup(this.lutRenderer.resources, this.bindGroupLayout, this.lutRenderer.usesCustomUniforms, this.makeExternalBindGroupEntries(config), this.rayMarchDistantSky);
    }

    public renderLutsAndSky(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms, atmosphere?: Atmosphere, forceConstantLutRendering?: boolean) {
        this.lutRenderer.renderLuts(passEncoder, uniforms, atmosphere, true, forceConstantLutRendering, !this.rayMarchDistantSky);
        this.renderSky(passEncoder);
    }

    get rayMarchDistantSky() {
        return this.doesRayMarchDistantSky;
    }
}

/**
 * A {@link SkyAtmosphereLutRenderer} that uses `GPUComputePipeline`s to render the sky / atmosphere.
 */
export class SkyAtmosphereComputeRenderer implements SkyAtmosphereRenderer {
    private constructor(
        private lutRenderer: SkyAtmosphereLutRenderer,
        private withLutsRenderer: SkyWithLutsComputeRenderer,
        private rayMarchRenderer: SkyRayMarchComputeRenderer,
        public defaultToFullResolutionRayMarch: boolean,
    ) {}

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
    static async createAsync(device: GPUDevice, config: SkyAtmosphereComputeRendererConfig, existingLutRenderer? : SkyAtmosphereLutRenderer, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources): Promise<SkyAtmosphereComputeRenderer> {
        const lutRenderer = existingLutRenderer ?? await SkyAtmosphereLutRenderer.createAsync(device, config, existingPipelines, existingResources);
        const [withLutsRenderer, rayMarchRenderer] = await Promise.all([SkyWithLutsComputeRenderer.createAsync(device, config, lutRenderer), SkyRayMarchComputeRenderer.createAsync(device, config, lutRenderer)]);
        return new SkyAtmosphereComputeRenderer(lutRenderer, withLutsRenderer, rayMarchRenderer, config.skyRenderer.defaultToPerPixelRayMarch ?? false);
    }

    /**
     * Creates a {@link SkyAtmosphereComputeRenderer}.
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingLutRenderer If this is defined, no new internal {@link SkyAtmosphereLutRenderer} will be created. Instead, the existing one is used.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static create(device: GPUDevice, config: SkyAtmosphereComputeRendererConfig, existingLutRenderer? : SkyAtmosphereLutRenderer, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources): SkyAtmosphereComputeRenderer {
        const lutRenderer = existingLutRenderer ?? SkyAtmosphereLutRenderer.create(device, config, existingPipelines, existingResources);
        return new SkyAtmosphereComputeRenderer(lutRenderer, SkyWithLutsComputeRenderer.create(device, config, lutRenderer), SkyRayMarchComputeRenderer.create(device, config, lutRenderer), config.skyRenderer.defaultToPerPixelRayMarch ?? false);
    }

    /**
     * Replaces potentially screen-size dependent external resources (back buffer, depth buffer, and render target) in the internal bind groups.
     *
     * @param config Configuration of external resources.
     */
    public onResize(config: SkyAtmosphereComputeRendererResizeConfig) {
        this.withLutsRenderer.onResize(config);
        this.rayMarchRenderer.onResize(config);
    }

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
    public renderSkyWithLuts(passEncoder: GPUComputePassEncoder) {
        this.withLutsRenderer.renderSky(passEncoder);
    }

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
    public renderSkyRaymarching(passEncoder: GPUComputePassEncoder) {
        this.rayMarchRenderer.renderSky(passEncoder);
    }

    /**
     * Renders the sky / atmosphere using either lookup tables or full-resolution ray marching, as well as all look up tables required by the respective approach.
     *
     * @param passEncoder A `GPUComputePassEncoder` to encode the sky / atmosphere rendering pass with. The encoder is not `end()`ed by this function.
     * @param useFullResolutionRayMarch If this is true, full-resolution ray marching will be used to render the sky / atmosphere. Defaults to {@link defaultToFullResolutionRayMarch}.
     *
     * @see {@link renderSkyWithLuts}: Renders the sky with lookup tables.
     * @see {@link renderSkyRaymarching}: Renders the sky with full-resolution ray marching.
     */
    public renderSky(passEncoder: GPUComputePassEncoder, useFullResolutionRayMarch?: boolean) {
        if (useFullResolutionRayMarch ?? this.defaultToFullResolutionRayMarch) {
            this.renderSkyRaymarching(passEncoder);
        } else {
            this.renderSkyWithLuts(passEncoder);
        }
    }

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
    public renderLutsAndSky(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms, atmosphere?: Atmosphere, useFullResolutionRayMarch?: boolean, forceConstantLutRendering?: boolean) {
        const useRayMarch = useFullResolutionRayMarch ?? this.defaultToFullResolutionRayMarch;
        this.renderLuts(passEncoder, uniforms, atmosphere, useRayMarch, forceConstantLutRendering, !this.rayMarchRenderer.rayMarchDistantSky);
        this.renderSky(passEncoder, useRayMarch);
    }

    public updateAtmosphere(atmosphere: Atmosphere): void {
        this.lutRenderer.updateAtmosphere(atmosphere);
    }

    public updateUniforms(uniforms: Uniforms): void {
        this.lutRenderer.updateUniforms(uniforms);
    }

    public renderTransmittanceLut(passEncoder: GPUComputePassEncoder): void {
        this.lutRenderer.renderTransmittanceLut(passEncoder);
    }

    public renderMultiScatteringLut(passEncoder: GPUComputePassEncoder): void {
        this.lutRenderer.renderMultiScatteringLut(passEncoder);
    }

    public renderConstantLuts(passEncoder: GPUComputePassEncoder, atmosphere?: Atmosphere): void {
        this.lutRenderer.renderConstantLuts(passEncoder, atmosphere);
    }

    public renderSkyViewLut(passEncoder: GPUComputePassEncoder): void {
        this.lutRenderer.renderSkyViewLut(passEncoder);
    }

    public renderAerialPerspectiveLut(passEncoder: GPUComputePassEncoder): void {
        this.lutRenderer.renderAerialPerspectiveLut(passEncoder);
    }

    public renderDynamicLuts(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms): void {
        this.lutRenderer.renderDynamicLuts(passEncoder, uniforms);
    }

    public renderLuts(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms, atmosphere?: Atmosphere, useFullResolutionRayMarch?: boolean, forceConstantLutRendering?: boolean, forceSkyViewLutRendering?: boolean): void {
        this.lutRenderer.renderLuts(passEncoder, uniforms, atmosphere, useFullResolutionRayMarch, forceConstantLutRendering, forceSkyViewLutRendering);
    }

    get resources(): SkyAtmosphereResources {
        return this.lutRenderer.resources;
    }
}
