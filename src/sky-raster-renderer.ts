/*
 * Copyright (c) 2024 Lukas Herzberger
 * SPDX-License-Identifier: MIT
 */

import { Atmosphere } from './atmosphere.js';
import { SkyAtmosphereRasterRendererConfig } from './config.js';
import { SkyAtmosphereRenderer, SkyAtmosphereLutRenderer } from './lut-renderer.js';
import { SkyAtmospherePipelines } from './pipelines.js';
import { SkyAtmosphereResources } from './resources.js';
import { makeRenderSkyLutAndRaymarchingShaderCode, makeRenderSkyRaymarchingShaderCode, makeRenderSkyWithLutsShaderCode } from './shaders.js';
import { makeRayMarchBindGroup, makeRayMarchBindGroupLayout, makeRayMarchConstantsBase, makeWithLutsBindGroup, makeWithLutsBindGroupLayout, makeWithLutsConstants } from './sky-renderer-utils.js';
import { Uniforms } from './uniforms.js';
import { RenderPass } from './util.js';

abstract class SkyRasterRenderer implements SkyAtmosphereRenderer {
    private pass: RenderPass;
    private bundle?: GPURenderBundle;
    protected doesRayMarchDistantSky: boolean;

    constructor(
        readonly targetFormats: GPUTextureFormat[],
        readonly lutRenderer: SkyAtmosphereLutRenderer,
        protected bindGroupLayout: GPUBindGroupLayout,
        pipeline: GPURenderPipeline,
        config: SkyAtmosphereRasterRendererConfig,
        isRayMarchPass: boolean,
    ) {
        this.doesRayMarchDistantSky = config.skyRenderer.rayMarch?.rayMarchDistantSky ?? true;

        const bindGroup = this.makeBindGroup(config.skyRenderer.depthBuffer.view ?? config.skyRenderer.depthBuffer.texture);

        this.pass = new RenderPass(
            pipeline,
            [
                bindGroup,
                ...(isRayMarchPass ? config.shadow?.bindGroups ?? [] : []),
                ...(config.customUniformsSource?.bindGroups ?? []),
            ],
        );

        if (config.skyRenderer.recordInternalRenderBundles ?? true) {
            this.bundle = this.recordBundle();
        }
    }

    protected static makeBlendStates() {
        return {
            single: {
                color: {
                    operation: 'add',
                    srcFactor: 'one',
                    dstFactor: 'one-minus-src-alpha',
                },
                alpha: {
                    operation: 'add',
                    srcFactor: 'zero',
                    dstFactor: 'one',
                },
            } as GPUBlendState,
            dual: {
                color: {
                    operation: 'add',
                    srcFactor: 'one',
                    dstFactor: 'src1',
                },
                alpha: {
                    operation: 'add',
                    srcFactor: 'zero',
                    dstFactor: 'one',
                },
            } as GPUBlendState,
        };
    }

    protected static makeExternalBindGroupLayoutEntries(config: SkyAtmosphereRasterRendererConfig): GPUBindGroupLayoutEntry[] {
        return [
            {
                binding: 6,
                visibility: GPUShaderStage.FRAGMENT,
                texture: {
                    sampleType: 'unfilterable-float',
                    viewDimension: config.skyRenderer.depthBuffer.texture.dimension,
                    multisampled: false,
                },
            },
        ];
    }

    protected makeExternalBindGroupEntries(depthBuffer: GPUTextureView | GPUTexture): GPUBindGroupEntry[] {
        return [
            {
                binding: 6,
                resource: depthBuffer instanceof GPUTextureView ? depthBuffer : depthBuffer.createView(depthBuffer.format.includes('depth') ? {
                    aspect: 'depth-only',
                } : {}),
            },
        ];
    }

    protected abstract makeBindGroup(depthBuffer: GPUTextureView | GPUTexture): GPUBindGroup;

    /**
     * Replaces potentially screen-size dependent external resources (depth buffer) in the internal bind groups.
     *
     * @param depthBuffer The depth buffer to limit the ray marching distance when rendering the sky / atmosphere.
     *                    If this is a textue, a texture view will be created.
     *                    If this is a texture view, it must be allowed to be bound as a `texture<f32>`.
     *                    I.e., if the texture has a depth-stencil format, the texture view must be a `"depth-only"` view.
     */
    public onResize(depthBuffer: GPUTextureView | GPUTexture) {
        this.pass.replaceBindGroup(0, this.makeBindGroup(depthBuffer));
        if (this.bundle) {
            this.bundle = this.recordBundle();
        }
    }

    /**
     * Renders the sky / atmosphere.
     *
     * @param passEncoder A `GPURenderPassEncoder` or `GPURenderBundleEncoder` to encode the pass with. The encoder is not `end()`ed by this function.
     */
    public renderSky(passEncoder: GPURenderPassEncoder | GPURenderBundleEncoder) {
        if (passEncoder instanceof GPURenderPassEncoder && this.bundle) {
            passEncoder.executeBundles([this.bundle]);
        } else {
            this.pass.encode(passEncoder);
        }
    }

    private recordBundle(): GPURenderBundle {
        const encoder = this.lutRenderer.resources.device.createRenderBundleEncoder({
            label: 'Render sky bundle',
            colorFormats: this.targetFormats,
        });
        this.renderSky(encoder);
        return encoder.finish();
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

    public renderLuts(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms, atmosphere?: Atmosphere, skipDynamicLutRendering?: boolean, forceConstantLutRendering?: boolean, forceSkyViewLutRendering?: boolean): void {
        this.lutRenderer.renderLuts(passEncoder, uniforms, atmosphere, skipDynamicLutRendering, forceConstantLutRendering, forceSkyViewLutRendering);
    }

    get resources(): SkyAtmosphereResources {
        return this.lutRenderer.resources;
    }
}

/**
 * A sky / atmosphere renderer that renders the sky based on lookup tables.
 * It uses `GPURenderPipeline`s to render the sky / atmosphere.
 */
export class SkyWithLutsRasterRenderer extends SkyRasterRenderer {
    private constructor(
        readonly targetFormats: GPUTextureFormat[],
        readonly lutRenderer: SkyAtmosphereLutRenderer,
        protected bindGroupLayout: GPUBindGroupLayout,
        pipeline: GPURenderPipeline,
        config: SkyAtmosphereRasterRendererConfig,
    ) {
        super(targetFormats, lutRenderer, bindGroupLayout, pipeline, config, false);
    }

    private static makeBindGroupLayout(device: GPUDevice, config: SkyAtmosphereRasterRendererConfig, resources: SkyAtmosphereResources): GPUBindGroupLayout {
        return makeWithLutsBindGroupLayout(device, config, this.makeExternalBindGroupLayoutEntries(config), resources, GPUShaderStage.FRAGMENT);
    }

    private static makePipelineDescriptor(device: GPUDevice, config: SkyAtmosphereRasterRendererConfig, lutRenderer: SkyAtmosphereLutRenderer, bindGroupLayout: GPUBindGroupLayout, blendState: GPUBlendState, dualBlendState: GPUBlendState, useDualSourceBlending: boolean): [GPURenderPipelineDescriptor, GPUTextureFormat[]] {
        const writeTransmissionOnlyOnPerPixelRayMarch = config.skyRenderer.writeTransmissionOnlyOnPerPixelRayMarch ?? true;
        const useTwoTargets = config.skyRenderer.transmissionFormat && !useDualSourceBlending && !writeTransmissionOnlyOnPerPixelRayMarch;
        const targets: GPUColorTargetState[] = [
            {
                format: config.skyRenderer.renderTargetFormat,
                writeMask: GPUColorWrite.ALL,
            },
        ];
        if (useTwoTargets) {
            targets.push({ format: config.skyRenderer.transmissionFormat!, });
        } else {
            targets[0].blend = useDualSourceBlending && !writeTransmissionOnlyOnPerPixelRayMarch ? dualBlendState : blendState;
        }

        let code = makeRenderSkyWithLutsShaderCode('rgba16float', config.customUniformsSource?.wgslCode);
        if (useDualSourceBlending && !writeTransmissionOnlyOnPerPixelRayMarch) {
            code = `enable dual_source_blending;\n${code}`;
            code = code.replace('@location(0)', '@location(0) @blend_src(0)');
            code = code.replace('@location(1)', '@location(0) @blend_src(1)');
        } else if (targets.length !== 2) {
            code = code.replace('@location(1) transmittance: vec4<f32>,', '');
            code = code.replace(
                'RenderSkyFragment(vec4(result.rgb, 1.0), vec4(vec3(result.a), 1.0))',
                'RenderSkyFragment(result)',
            );
        }

        const module = device.createShaderModule({
            label: 'Render sky with LUTs',
            code,
        });

        return [
            {
                label: `Render sky with LUTs pipeline [${lutRenderer.resources.label}]`,
                layout: device.createPipelineLayout({
                    label: 'Render sky with LUTs pipeline layout',
                    bindGroupLayouts: [
                        bindGroupLayout,
                        ...(config.customUniformsSource?.bindGroupLayouts ?? []),
                    ],
                }),
                vertex: {
                    module,
                },
                fragment: {
                    module,
                    constants: makeWithLutsConstants(config, lutRenderer),
                    targets,
                },
            },
            targets.map(t => t.format),
        ];
    }

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
    static async createAsync(device: GPUDevice, config: SkyAtmosphereRasterRendererConfig, existingLutRenderer?: SkyAtmosphereLutRenderer, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources): Promise<SkyWithLutsRasterRenderer> {
        const useDualSourceBlending = device.features.has('dual-source-blending') && (config.skyRenderer.rayMarch?.useColoredTransmittance ?? false);
        if (!useDualSourceBlending && config.skyRenderer.rayMarch?.useColoredTransmittance) {
            console.warn('[SkyAtmosphereRasterRenderer]: dual source blending was requested but the device feature is not enabled');
        }
        const lutRenderer = existingLutRenderer ?? await SkyAtmosphereLutRenderer.createAsync(device, config, existingPipelines, existingResources);
        const bindGroupLayout = this.makeBindGroupLayout(device, config, lutRenderer.resources);
        const blendStates = this.makeBlendStates();
        const [descriptor, targetFormats] = this.makePipelineDescriptor(device, config, lutRenderer, bindGroupLayout, blendStates.single, blendStates.dual, useDualSourceBlending);
        const pipeline = await device.createRenderPipelineAsync(descriptor);
        return new SkyWithLutsRasterRenderer(
            targetFormats,
            lutRenderer,
            bindGroupLayout,
            pipeline,
            config,
        );
    }

    /**
     * Creates a {@link SkyAtmosphereComputeRenderer}.
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRasterRendererConfig} used to configure internal resources and behavior.
     * @param existingLutRenderer If this is defined, no new internal {@link SkyAtmosphereLutRenderer} will be created. Instead, the existing one is used.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static create(device: GPUDevice, config: SkyAtmosphereRasterRendererConfig, existingLutRenderer?: SkyAtmosphereLutRenderer, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources): SkyWithLutsRasterRenderer {
        const useDualSourceBlending = device.features.has('dual-source-blending') && (config.skyRenderer.rayMarch?.useColoredTransmittance ?? false);
        if (!useDualSourceBlending && config.skyRenderer.rayMarch?.useColoredTransmittance) {
            console.warn('[SkyAtmosphereRasterRenderer]: dual source blending was requested but the device feature is not enabled');
        }

        const lutRenderer = existingLutRenderer ?? SkyAtmosphereLutRenderer.create(device, config, existingPipelines, existingResources);
        const bindGroupLayout = this.makeBindGroupLayout(device, config, lutRenderer.resources);
        const blendStates = this.makeBlendStates();
        const [descriptor, targetFormats] = this.makePipelineDescriptor(device, config, lutRenderer, bindGroupLayout, blendStates.single, blendStates.dual, useDualSourceBlending);
        const pipeline = device.createRenderPipeline(descriptor);
        return new SkyWithLutsRasterRenderer(
            targetFormats,
            lutRenderer,
            bindGroupLayout,
            pipeline,
            config,
        );
    }

    protected makeBindGroup(depthBuffer: GPUTextureView | GPUTexture): GPUBindGroup {
        return makeWithLutsBindGroup(this.lutRenderer.resources, this.bindGroupLayout, this.lutRenderer.usesCustomUniforms, this.makeExternalBindGroupEntries(depthBuffer));
    }

    public renderLuts(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms, atmosphere?: Atmosphere, skipDynamicLutRendering?: boolean, forceConstantLutRendering?: boolean, forceSkyViewLutRendering?: boolean): void {
        this.lutRenderer.renderLuts(passEncoder, uniforms, atmosphere, skipDynamicLutRendering ?? false, forceConstantLutRendering, forceSkyViewLutRendering);
    }
}

/**
 * A sky / atmosphere renderer that renders the sky using full-resolution ray marching.
 * It uses `GPURenderPipeline`s to render the sky / atmosphere.
 */
export class SkyRayMarchRasterRenderer extends SkyRasterRenderer {
    private constructor(
        readonly targetFormats: GPUTextureFormat[],
        readonly lutRenderer: SkyAtmosphereLutRenderer,
        protected bindGroupLayout: GPUBindGroupLayout,
        pipeline: GPURenderPipeline,
        config: SkyAtmosphereRasterRendererConfig,
    ) {
        super(targetFormats, lutRenderer, bindGroupLayout, pipeline, config, true);
    }

    private static makeBindGroupLayout(device: GPUDevice, config: SkyAtmosphereRasterRendererConfig, resources: SkyAtmosphereResources, rayMarchDistantSky: boolean): GPUBindGroupLayout {
        return makeRayMarchBindGroupLayout(device, config, this.makeExternalBindGroupLayoutEntries(config), resources, rayMarchDistantSky, GPUShaderStage.FRAGMENT);
    }

    private static makePipelineDescriptor(device: GPUDevice, config: SkyAtmosphereRasterRendererConfig, lutRenderer: SkyAtmosphereLutRenderer, bindGroupLayout: GPUBindGroupLayout, rayMarchDistantSky: boolean, blendState: GPUBlendState, dualBlendState: GPUBlendState, useDualSourceBlending: boolean): [GPURenderPipelineDescriptor, GPUTextureFormat[]] {
        const useTwoTargets = config.skyRenderer.transmissionFormat && !useDualSourceBlending;
            const targets: GPUColorTargetState[] = [
                {
                    format: config.skyRenderer.renderTargetFormat,
                    writeMask: GPUColorWrite.ALL,
                },
            ];
            if (useTwoTargets) {
                targets.push({ format: config.skyRenderer.transmissionFormat!, });
            } else {
                targets[0].blend = useDualSourceBlending ? dualBlendState : blendState;
            }

            let code = (rayMarchDistantSky ? makeRenderSkyRaymarchingShaderCode : makeRenderSkyLutAndRaymarchingShaderCode)('rgba16float', config.shadow?.wgslCode, config.customUniformsSource?.wgslCode);
            if (useDualSourceBlending) {
                code = code.replace('@location(0)', '@location(0) @blend_src(0)');
                code = code.replace('@location(1)', '@location(0) @blend_src(1)');
            } else if (targets.length !== 2) {
                code = code.replace('@location(1) transmittance: vec4<f32>,', '');
                code = code.replace(
                    'RenderSkyFragment(result.luminance, result.transmittance)',
                    'RenderSkyFragment(vec4(result.luminance.rgb, 1.0 - dot(result.transmittance.rgb, vec3(1.0 / 3.0))))',
                );
            }
            const module = device.createShaderModule({
                label: 'Render sky raymarching',
                code: `${useDualSourceBlending ? 'enable dual_source_blending;\n' : ''}${code}`,
            });

            return [
                {
                    label: `Render sky raymarching pipeline [${lutRenderer.resources.label}]`,
                    layout: device.createPipelineLayout({
                        label: `Render sky raymarching pipeline layout [${lutRenderer.resources.label}]`,
                        bindGroupLayouts: [
                            bindGroupLayout,
                            ...(config.shadow?.bindGroupLayouts || []),
                            ...(config.customUniformsSource?.bindGroupLayouts ?? []),
                        ],
                    }),
                    vertex: {
                        module,
                    },
                    fragment: {
                        module,
                        constants: makeRayMarchConstantsBase(config, lutRenderer, rayMarchDistantSky),
                        targets,
                    },
                },
                targets.map(t => t.format),
            ];
    }

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
    static async createAsync(device: GPUDevice, config: SkyAtmosphereRasterRendererConfig, existingLutRenderer?: SkyAtmosphereLutRenderer, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources): Promise<SkyRayMarchRasterRenderer> {
        const useDualSourceBlending = device.features.has('dual-source-blending') && (config.skyRenderer.rayMarch?.useColoredTransmittance ?? false);
        if (!useDualSourceBlending && config.skyRenderer.rayMarch?.useColoredTransmittance) {
            console.warn('[SkyAtmosphereRasterRenderer]: dual source blending was requested but the device feature is not enabled');
        }
        const rayMarchDistantSky = config.skyRenderer.rayMarch?.rayMarchDistantSky ?? true;
        const lutRenderer = existingLutRenderer ?? await SkyAtmosphereLutRenderer.createAsync(device, config, existingPipelines, existingResources);
        const bindGroupLayout = this.makeBindGroupLayout(device, config, lutRenderer.resources, rayMarchDistantSky);
        const blendStates = this.makeBlendStates();
        const [descriptor, targetFormats] = this.makePipelineDescriptor(device, config, lutRenderer, bindGroupLayout, rayMarchDistantSky, blendStates.single, blendStates.dual, useDualSourceBlending);
        const pipeline = await device.createRenderPipelineAsync(descriptor);
        return new SkyRayMarchRasterRenderer(
            targetFormats,
            lutRenderer,
            bindGroupLayout,
            pipeline,
            config,
        );
    }

    /**
     * Creates a {@link SkyAtmosphereComputeRenderer}.
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRasterRendererConfig} used to configure internal resources and behavior.
     * @param existingLutRenderer If this is defined, no new internal {@link SkyAtmosphereLutRenderer} will be created. Instead, the existing one is used.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static create(device: GPUDevice, config: SkyAtmosphereRasterRendererConfig, existingLutRenderer?: SkyAtmosphereLutRenderer, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources): SkyRayMarchRasterRenderer {
        const useDualSourceBlending = device.features.has('dual-source-blending') && (config.skyRenderer.rayMarch?.useColoredTransmittance ?? false);
        if (!useDualSourceBlending && config.skyRenderer.rayMarch?.useColoredTransmittance) {
            console.warn('[SkyAtmosphereRasterRenderer]: dual source blending was requested but the device feature is not enabled');
        }
        const rayMarchDistantSky = config.skyRenderer.rayMarch?.rayMarchDistantSky ?? true;
        const lutRenderer = existingLutRenderer ?? SkyAtmosphereLutRenderer.create(device, config, existingPipelines, existingResources);
        const bindGroupLayout = this.makeBindGroupLayout(device, config, lutRenderer.resources, rayMarchDistantSky);
        const blendStates = this.makeBlendStates();
        const [descriptor, targetFormats] = this.makePipelineDescriptor(device, config, lutRenderer, bindGroupLayout, rayMarchDistantSky, blendStates.single, blendStates.dual, useDualSourceBlending);
        const pipeline = device.createRenderPipeline(descriptor);
        return new SkyRayMarchRasterRenderer(
            targetFormats,
            lutRenderer,
            bindGroupLayout,
            pipeline,
            config,
        );
    }

    protected makeBindGroup(depthBuffer: GPUTextureView | GPUTexture): GPUBindGroup {
        return makeRayMarchBindGroup(this.lutRenderer.resources, this.bindGroupLayout, this.lutRenderer.usesCustomUniforms, this.makeExternalBindGroupEntries(depthBuffer), this.rayMarchDistantSky);
    }

    public renderLuts(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms, atmosphere?: Atmosphere, skipDynamicLutRendering?: boolean, forceConstantLutRendering?: boolean, forceSkyViewLutRendering?: boolean): void {
        this.lutRenderer.renderLuts(passEncoder, uniforms, atmosphere, skipDynamicLutRendering ?? true, forceConstantLutRendering, !this.rayMarchDistantSky || forceSkyViewLutRendering);
    }

    get rayMarchDistantSky() {
        return this.doesRayMarchDistantSky;
    }
}

/**
 * A sky / atmosphere renderer that uses `GPURenderPipeline`s to render the sky / atmosphere.
 */
export class SkyAtmosphereRasterRenderer implements SkyAtmosphereRenderer {
    private constructor(
        readonly lutRenderer: SkyAtmosphereLutRenderer,
        readonly withLutsRenderer: SkyWithLutsRasterRenderer,
        readonly rayMarchRenderer: SkyRayMarchRasterRenderer,
        public defaultToFullResolutionRayMarch: boolean,
    ) {}

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
    static async createAsync(device: GPUDevice, config: SkyAtmosphereRasterRendererConfig, existingLutRenderer?: SkyAtmosphereLutRenderer, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources): Promise<SkyAtmosphereRasterRenderer> {
        const lutRenderer = existingLutRenderer ?? await SkyAtmosphereLutRenderer.createAsync(device, config, existingPipelines, existingResources);
        const [withLutsRenderer, rayMarchRenderer] = await Promise.all([SkyWithLutsRasterRenderer.createAsync(device, config, lutRenderer), SkyRayMarchRasterRenderer.createAsync(device, config, lutRenderer)]);
        return new SkyAtmosphereRasterRenderer(lutRenderer, withLutsRenderer, rayMarchRenderer, config.skyRenderer.defaultToPerPixelRayMarch ?? false);
    }

    /**
     * Creates a {@link SkyAtmosphereRasterRenderer}.
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingLutRenderer If this is defined, no new internal {@link SkyAtmosphereLutRenderer} will be created. Instead, the existing one is used.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static create(device: GPUDevice, config: SkyAtmosphereRasterRendererConfig, existingLutRenderer?: SkyAtmosphereLutRenderer, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources): SkyAtmosphereRasterRenderer {
        const lutRenderer = existingLutRenderer ?? SkyAtmosphereLutRenderer.create(device, config, existingPipelines, existingResources);
        return new SkyAtmosphereRasterRenderer(lutRenderer, SkyWithLutsRasterRenderer.create(device, config, lutRenderer), SkyRayMarchRasterRenderer.create(device, config, lutRenderer), config.skyRenderer.defaultToPerPixelRayMarch ?? false);
    }

    /**
     * Replaces potentially screen-size dependent external resources (depth buffer) in the internal bind groups.
     *
     * @param depthBuffer The depth buffer to limit the ray marching distance when rendering the sky / atmosphere.
     *                    If this is a textue, a texture view will be created.
     *                    If this is a texture view, it must be allowed to be bound as a `texture<f32>`.
     *                    I.e., if the texture has a depth-stencil format, the texture view must be a `"depth-only"` view.
     */
    public onResize(depthBuffer: GPUTextureView | GPUTexture) {
        this.withLutsRenderer.onResize(depthBuffer);
        this.rayMarchRenderer.onResize(depthBuffer);
    }

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
    public renderSkyWithLuts(passEncoder: GPURenderPassEncoder | GPURenderBundleEncoder) {
        this.withLutsRenderer.renderSky(passEncoder);
    }

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
    public renderSkyRaymarching(passEncoder: GPURenderPassEncoder | GPURenderBundleEncoder) {
        this.rayMarchRenderer.renderSky(passEncoder);
    }

    /**
     * Renders the sky / atmosphere using either lookup tables or full-resolution ray marching, as well as all look up tables required by the respective approach.
     *
     * @param passEncoder A `GPURenderPassEncoder` or `GPURenderBundleEncoder` to encode the sky / atmosphere rendering pass with. The encoder is not `end()`ed by this function.
     * @param useFullResolutionRayMarch If this is true, full-resolution ray marching will be used to render the sky / atmosphere. Defaults to {@link defaultToFullResolutionRayMarch}.
     *
     * @see {@link renderSkyWithLuts}: Renders the sky with lookup tables.
     * @see {@link renderSkyRaymarching}: Renders the sky with full-resolution ray marching.
     */
    public renderSky(passEncoder: GPURenderPassEncoder | GPURenderBundleEncoder, useFullResolutionRayMarch?: boolean) {
        if (useFullResolutionRayMarch ?? this.defaultToFullResolutionRayMarch) {
            this.renderSkyRaymarching(passEncoder);
        } else {
            this.renderSkyWithLuts(passEncoder);
        }
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

    public renderLuts(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms, atmosphere?: Atmosphere, useFullResolutionRayMarch?: boolean, forceConstantLutRendering?: boolean, forceSkyViewLutRendering?: boolean) {
        this.lutRenderer.renderLuts(passEncoder, uniforms, atmosphere, useFullResolutionRayMarch, forceConstantLutRendering, !this.rayMarchRenderer.rayMarchDistantSky || forceSkyViewLutRendering);
    }

    get resources(): SkyAtmosphereResources {
        return this.lutRenderer.resources;
    }
}