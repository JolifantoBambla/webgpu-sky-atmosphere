/*
 * Copyright (c) 2024 Lukas Herzberger
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
    TransmittanceLutConfig,
} from './config.js';

import { Camera, AtmosphereLight, Uniforms } from './uniforms.js';
import {
    atmosphereToFloatArray,
    ATMOSPHERE_BUFFER_SIZE,
    uniformsToFloatArray,
    UNIFORMS_BUFFER_SIZE,
    SkyAtmosphereResources,
} from './resources.js';

import {
    makeRenderSkyWithLutsShaderCode,
    makeRenderSkyRaymarchingShaderCode,
    makeRenderSkyLutAndRaymarchingShaderCode,
} from './shaders.js';
import { SkyAtmospherePipelines } from './pipelines.js';
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
    TransmittanceLutConfig,
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

export class SkyAtmosphereRenderer {
    readonly resources: SkyAtmosphereResources;
    readonly skyAtmospherePipelines: SkyAtmospherePipelines;
    public defaultToPerPixelRayMarch: boolean;
    readonly usesCustomUniforms: boolean;
    protected transmittanceLutPass: ComputePass;
    protected multiScatteringLutPass: ComputePass;
    protected skyViewLutPass: ComputePass;
    protected aerialPerspectiveLutPass: ComputePass;

    protected constructor(
        lutRenderer?: SkyAtmosphereRenderer,
        resources?: SkyAtmosphereResources,
        skyAtmospherePipelines?: SkyAtmospherePipelines,
        defaultToPerPixelRayMarch?: boolean,
        usesCustomUniforms?: boolean,
        transmittanceLutPass?: ComputePass,
        multiScatteringLutPass?: ComputePass,
        skyViewLutPass?: ComputePass,
        aerialPerspectiveLutPass?: ComputePass,
    ) {
        if (lutRenderer) {
            this.resources = lutRenderer.resources;
            this.skyAtmospherePipelines = lutRenderer.skyAtmospherePipelines;
            this.defaultToPerPixelRayMarch = lutRenderer.defaultToPerPixelRayMarch;
            this.usesCustomUniforms = lutRenderer.usesCustomUniforms;
            this.transmittanceLutPass = lutRenderer.transmittanceLutPass;
            this.multiScatteringLutPass = lutRenderer.multiScatteringLutPass;
            this.skyViewLutPass = lutRenderer.skyViewLutPass;
            this.aerialPerspectiveLutPass = lutRenderer.aerialPerspectiveLutPass;
        } else {
            this.resources = resources!;
            this.skyAtmospherePipelines = skyAtmospherePipelines!;
            this.defaultToPerPixelRayMarch = defaultToPerPixelRayMarch!;
            this.usesCustomUniforms = usesCustomUniforms!;
            this.transmittanceLutPass = transmittanceLutPass!;
            this.multiScatteringLutPass = multiScatteringLutPass!;
            this.skyViewLutPass = skyViewLutPass!;
            this.aerialPerspectiveLutPass = aerialPerspectiveLutPass!;
        }
    }

    /**
     * Creates a {@link SkyAtmosphereRenderer}.
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static create(device: GPUDevice, config: SkyAtmosphereRendererConfig, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources): SkyAtmosphereRenderer {
        let skyAtmospherePipelines;
        if ((existingPipelines?.transmittanceLutPipeline.device || device) !== device) {
            skyAtmospherePipelines = SkyAtmospherePipelines.create(device, config);
        } else {
            skyAtmospherePipelines = existingPipelines || SkyAtmospherePipelines.create(device, config);
        }

        const defaultToPerPixelRayMarch = config.skyRenderer?.defaultToPerPixelRayMarch ?? false;
        const usesCustomUniforms = config.customUniformsSource !== undefined;

        const resources = existingResources || new SkyAtmosphereResources(device, config);

        const transmittanceLutPass = skyAtmospherePipelines.transmittanceLutPipeline.makeComputePass(resources);
        const multiScatteringLutPass = skyAtmospherePipelines.multiScatteringLutPipeline.makeComputePass(resources);
        const skyViewLutPass = skyAtmospherePipelines.skyViewLutPipeline.makeComputePass(resources, (config.lookUpTables?.skyViewLut?.affectedByShadow ?? true) ? config.shadow?.bindGroups : undefined, config.customUniformsSource?.bindGroups);
        const aerialPerspectiveLutPass = skyAtmospherePipelines.aerialPerspectiveLutPipeline.makeComputePass(resources, (config.lookUpTables?.aerialPerspectiveLut?.affectedByShadow ?? true) ? config.shadow?.bindGroups : undefined, config.customUniformsSource?.bindGroups);

        const lutRenderer = new SkyAtmosphereRenderer(
            undefined,
            resources,
            skyAtmospherePipelines,
            defaultToPerPixelRayMarch,
            usesCustomUniforms,
            transmittanceLutPass,
            multiScatteringLutPass,
            skyViewLutPass,
            aerialPerspectiveLutPass,
        );

        if (config.initializeConstantLuts ?? true) {
            const commandEncoder = device.createCommandEncoder();
            const computePassEncoder = commandEncoder.beginComputePass();
            lutRenderer.renderConstantLuts(computePassEncoder);
            computePassEncoder.end();
            device.queue.submit([commandEncoder.finish()]);
        }

        return lutRenderer;
    }

    /**
     * Asynchronously creates a {@link SkyAtmosphereRenderer}.
     *
     * All pipelines used by this renderer are created asynchronously.
     *
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static async createAsync(device: GPUDevice, config: SkyAtmosphereRendererConfig, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources): Promise<SkyAtmosphereRenderer> {
        let skyAtmospherePipelines;
        if ((existingPipelines?.transmittanceLutPipeline.device || device) !== device) {
            skyAtmospherePipelines = await SkyAtmospherePipelines.createAsync(device, config);
        } else {
            skyAtmospherePipelines = existingPipelines || await SkyAtmospherePipelines.createAsync(device, config);
        }
        return this.create(device, config, skyAtmospherePipelines, existingResources);
    }

    /**
     * Updates the renderer's internal uniform buffer containing the {@link Atmosphere} parameters as well as its host-side copy of {@link Atmosphere} parameters.
     * @param atmosphere The new {@link Atmosphere} to override the current parameters.
     *
     * @see {@link SkyAtmosphereResources.updateAtmosphere}: Called internally to update the {@link Atmosphere} parameters.
     */
    public updateAtmosphere(atmosphere: Atmosphere) {
        this.resources.updateAtmosphere(atmosphere);
    }

    /**
     * Updates the renderer's internal uniform buffer containing the {@link Uniforms} as well as its host-side copy of {@link Uniforms}.
     * @param uniforms The new {@link Uniforms} to override the current parameters.
     *
     * If custom uniform buffers are used, this does nothing (see {@link CustomUniformsSourceConfig}).
     *
     * @see {@link SkyAtmosphereResources.updateUniforms}: Called internally to update the {@link Uniforms}.
     */
    public updateUniforms(uniforms: Uniforms) {
        if (!this.usesCustomUniforms) {
            this.resources.updateUniforms(uniforms);
        }
    }

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
    public renderTransmittanceLut(passEncoder: GPUComputePassEncoder) {
        this.transmittanceLutPass.encode(passEncoder);
    }

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
    public renderMultiScatteringLut(passEncoder: GPUComputePassEncoder) {
        this.multiScatteringLutPass.encode(passEncoder);
    }

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
     * @see {@link updateAtmosphere}: Called internally, if the {@link atmosphere} parameter is not undefined.
     * @see {@link renderTransmittanceLut}: Called internally to render the transmittance lookup table.
     * @see {@link renderMultiScatteringLut}: Called internally to render the multiple scattering lookup table.
     */
    public renderConstantLuts(passEncoder: GPUComputePassEncoder, atmosphere?: Atmosphere) {
        if (atmosphere) {
            this.updateAtmosphere(atmosphere);
        }
        this.renderTransmittanceLut(passEncoder);
        this.renderMultiScatteringLut(passEncoder);
    }

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
    public renderSkyViewLut(passEncoder: GPUComputePassEncoder) {
        this.skyViewLutPass.encode(passEncoder);
    }

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
    public renderAerialPerspectiveLut(passEncoder: GPUComputePassEncoder) {
        this.aerialPerspectiveLutPass.encode(passEncoder);
    }

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
     * @see {@link updateUniforms}: Called internally, if the {@link uniforms} parameter is not undefined.
     * @see {@link renderSkyViewLut}: Called internally to render the sky view lookup table.
     * @see {@link renderAerialPerspectiveLut}: called internally to render the aerial perspective lookup table.
     */
    public renderDynamicLuts(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms) {
        if (uniforms) {
            this.updateUniforms(uniforms);
        }
        this.renderSkyViewLut(passEncoder);
        this.renderAerialPerspectiveLut(passEncoder);
    }

    /**
     * Renders the lookup tables required for rendering the sky / atmosphere.
     *
     * To initialize or update the transmittance and multiple scattering lookup tables, pass new {@link Atmosphere} paramters to this function or use the `forceConstantLutRendering` parameter.
     *
     * @param passEncoder A `GPUComputePassEncoder` to encode passes with. The encoder is not `end()`ed by this function.
     * @param uniforms {@link Uniforms} to use for this frame. If this is given, the internal uniform buffer will be updated using {@link updateUniforms}.
     * @param atmosphere {@link Atmosphere} parameters to use for this frame. If this is given, the internal uniform buffer storing the {@link Atmosphere} parameters will be updated and the transmittance and multiple scattering lookup tables will be rendered.
     * @param useFullScreenRayMarch If this is true, the sky view and aerial perspective lookup tables will not be rendered. Defaults to {@link defaultToPerPixelRayMarch}.
     * @param forceConstantLutRendering If this is true, the transmittance and multiple scattering lookup tables will be rendered regardless of whether the `atmosphere` parameter is `undefined` or not.
     *
     * @see {@link renderConstantLuts}: Called internally, if either `atmosphere` is defined or `forceConstantLutRendering` is true.
     * @see {@link updateUniforms}: Called internally, if full-screen ray marching is used and the `uniforms` parameter is not undefined.
     * @see {@link renderDynamicLuts}: Called internally, if the the `useFullScreenRayMarch` is true or if it is undefined and {@link defaultToPerPixelRayMarch} is true.
     */
    public renderSkyAtmosphereLuts(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms, atmosphere?: Atmosphere, useFullScreenRayMarch?: boolean, forceConstantLutRendering?: boolean) {
        if (atmosphere || (forceConstantLutRendering ?? false)) {
            this.renderConstantLuts(passEncoder, atmosphere);
        }
        if (useFullScreenRayMarch ?? false) {
            if (uniforms) {
                this.updateUniforms(uniforms);
            }
        } else {
            this.renderDynamicLuts(passEncoder, uniforms);
        }
    }
}

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

/**
 * A {@link SkyAtmosphereRenderer} that uses `GPUComputePipeline`s to render the sky / atmosphere.
 */
export class SkyAtmosphereComputeRenderer extends SkyAtmosphereRenderer {
    private renderSkyWithLutsPass: ComputePass;
    private renderSkyRaymarchingPass: ComputePass;

    private constructor(
        lutRenderer: SkyAtmosphereRenderer,
        private renderSkyWithLutsBindGroupLayout: GPUBindGroupLayout,
        private renderSkyRaymarchingBindGroupLayout: GPUBindGroupLayout,
        private rayMarchDistantSky: boolean,
        withLutsPipeline: GPUComputePipeline,
        rayMarchPipeline: GPUComputePipeline,
        config: SkyAtmosphereComputeRendererConfig,
    ) {
        super(lutRenderer);

        const [withLutsBindGroup, rayMarchingBindGroup] = this.makeBindGroups({
            depthBuffer: config.skyRenderer.depthBuffer.view ?? config.skyRenderer.depthBuffer.texture,
            backBuffer: config.skyRenderer.backBuffer.view ?? config.skyRenderer.backBuffer.texture,
            renderTarget: config.skyRenderer.renderTarget.view ?? config.skyRenderer.renderTarget.texture,
        });

        const dispatchDimensions: [number, number, number] = [
            Math.ceil(config.skyRenderer.renderTarget.texture.width / 16.0),
            Math.ceil(config.skyRenderer.renderTarget.texture.height / 16.0),
            1,
        ];

        this.renderSkyWithLutsPass = new ComputePass(
            withLutsPipeline,
            [withLutsBindGroup, ...(config.customUniformsSource?.bindGroups ?? [])],
            dispatchDimensions,
        );

        this.renderSkyRaymarchingPass = new ComputePass(
            rayMarchPipeline,
            [
                rayMarchingBindGroup,
                ...(config.shadow?.bindGroups ?? []),
                ...(config.customUniformsSource?.bindGroups ?? []),
            ],
            dispatchDimensions,
        );
    }

    private static makeBindGroupLayouts(device: GPUDevice, config: SkyAtmosphereComputeRendererConfig, resources: SkyAtmosphereResources, rayMarchDistantSky: boolean): [GPUBindGroupLayout, GPUBindGroupLayout] {
        const renderSkyBindGroupLayoutBaseEntries: GPUBindGroupLayoutEntry[] = [
            {
                binding: 0,
                visibility: GPUShaderStage.COMPUTE,
                buffer: {
                    type: 'uniform',
                    hasDynamicOffset: false,
                    minBindingSize: ATMOSPHERE_BUFFER_SIZE,
                },
            },
            config.customUniformsSource ? undefined : {
                binding: 1,
                visibility: GPUShaderStage.COMPUTE,
                buffer: {
                    type: 'uniform',
                    hasDynamicOffset: false,
                    minBindingSize: UNIFORMS_BUFFER_SIZE,
                },
            },
            {
                binding: 2,
                visibility: GPUShaderStage.COMPUTE,
                sampler: {
                    type: 'filtering',
                },
            },
            {
                binding: 3,
                visibility: GPUShaderStage.COMPUTE,
                texture: {
                    sampleType: 'float',
                    viewDimension: resources.transmittanceLut.texture.dimension,
                    multisampled: false,
                },
            },
        ].filter(e => e !== undefined) as GPUBindGroupLayoutEntry[];
        const externalResourcesLayoutEntries: GPUBindGroupLayoutEntry[] = [
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

        return [
            device.createBindGroupLayout({
                label: `Render sky with luts bind group layout [${resources.label}]`,
                entries: [
                    ...renderSkyBindGroupLayoutBaseEntries,
                    {
                        binding: 4,
                        visibility: GPUShaderStage.COMPUTE,
                        texture: {
                            sampleType: 'float',
                            viewDimension: resources.skyViewLut.texture.dimension,
                            multisampled: false,
                        },
                    },
                    {
                        binding: 5,
                        visibility: GPUShaderStage.COMPUTE,
                        texture: {
                            sampleType: 'float',
                            viewDimension: resources.aerialPerspectiveLut.texture.dimension,
                            multisampled: false,
                        },
                    },
                    ...externalResourcesLayoutEntries,
                ].map((v, i) => {
                    v.binding = i;
                    return v;
                }) as GPUBindGroupLayoutEntry[],
            }),
            device.createBindGroupLayout({
                label: `Render sky raymarching bind group layout [${resources.label}]`,
                entries: ([
                    ...renderSkyBindGroupLayoutBaseEntries,
                    {
                        binding: 4,
                        visibility: GPUShaderStage.COMPUTE,
                        texture: {
                            sampleType: 'float',
                            viewDimension: resources.multiScatteringLut.texture.dimension,
                            multisampled: false,
                        },
                    },
                    rayMarchDistantSky ? undefined : {
                        binding: 5,
                        visibility: GPUShaderStage.COMPUTE,
                        texture: {
                            sampleType: 'float',
                            viewDimension: resources.skyViewLut.texture.dimension,
                            multisampled: false,
                        },
                    },
                    ...externalResourcesLayoutEntries,
                ].filter(e => e !== undefined) as GPUBindGroupLayoutEntry[])
                .map((v, i) => {
                    v.binding = i;
                    return v;
                }) as GPUBindGroupLayoutEntry[],
            }),
        ];
    }

    private static makeWithLutsPiplelineDescriptor(device: GPUDevice, config: SkyAtmosphereComputeRendererConfig, lutRenderer: SkyAtmosphereRenderer, renderSkyWithLutsBindGroupLayout: GPUBindGroupLayout): GPUComputePipelineDescriptor {
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
                constants: {
                    AP_SLICE_COUNT: lutRenderer.resources.aerialPerspectiveLut.texture.depthOrArrayLayers,
                    AP_DISTANCE_PER_SLICE: lutRenderer.skyAtmospherePipelines.aerialPerspectiveLutPipeline.aerialPerspectiveDistancePerSlice,
                    AP_INV_DISTANCE_PER_SLICE: lutRenderer.skyAtmospherePipelines.aerialPerspectiveLutPipeline.aerialPerspectiveInvDistancePerSlice,
                    SKY_VIEW_LUT_RES_X: lutRenderer.resources.skyViewLut.texture.width,
                    SKY_VIEW_LUT_RES_Y: lutRenderer.resources.skyViewLut.texture.height,
                    IS_REVERSE_Z: Number(config.skyRenderer.depthBuffer.reverseZ ?? false),
                    RENDER_SUN_DISK: Number(config.lights?.renderSunDisk ?? true),
                    RENDER_MOON_DISK: Number(config.lights?.renderMoonDisk ?? (config.lights?.useMoon ?? false)),
                    LIMB_DARKENING_ON_SUN: Number(config.lights?.applyLimbDarkeningOnSun ?? true),
                    LIMB_DARKENING_ON_MOON: Number(config.lights?.applyLimbDarkeningOnMoon ?? false),
                    USE_MOON: Number(config.lights?.useMoon ?? false),
                },
            },
        };
    }

    private static makeRayMarchPipelineDescriptor(device: GPUDevice, config: SkyAtmosphereComputeRendererConfig, lutRenderer: SkyAtmosphereRenderer, renderSkyRaymarchingBindGroupLayout: GPUBindGroupLayout, rayMarchDistantSky: boolean): GPUComputePipelineDescriptor {
        const constants: Record<string, number> = {
            INV_DISTANCE_TO_MAX_SAMPLE_COUNT: 1.0 / (config.skyRenderer.distanceToMaxSampleCount ?? (100.0 * (config.distanceScaleFactor ?? 1.0))),
            RANDOMIZE_SAMPLE_OFFSET: Number(config.skyRenderer.rayMarch?.randomizeRayOffsets ?? true),
            MULTI_SCATTERING_LUT_RES_X: lutRenderer.resources.multiScatteringLut.texture.width,
            MULTI_SCATTERING_LUT_RES_Y: lutRenderer.resources.multiScatteringLut.texture.height,
            IS_REVERSE_Z: Number(config.skyRenderer.depthBuffer.reverseZ ?? false),
            RENDER_SUN_DISK: Number(config.lights?.renderSunDisk ?? true),
            RENDER_MOON_DISK: Number(config.lights?.renderMoonDisk ?? (config.lights?.useMoon ?? false)),
            LIMB_DARKENING_ON_SUN: Number(config.lights?.applyLimbDarkeningOnSun ?? true),
            LIMB_DARKENING_ON_MOON: Number(config.lights?.applyLimbDarkeningOnMoon ?? false),
            USE_MOON: Number(config.lights?.useMoon ?? false),
            USE_COLORED_TRANSMISSION: Number(config.skyRenderer.rayMarch?.useColoredTransmittance ?? true),
        };

        let module;
        if (rayMarchDistantSky) {
            module = device.createShaderModule({
                code: `${config.shadow?.wgslCode || 'fn get_shadow(p: vec3<f32>, i: u32) -> f32 { return 1.0; }'}\n${makeRenderSkyRaymarchingShaderCode(config.skyRenderer.renderTarget.texture.format, config.customUniformsSource?.wgslCode)}`,
            });
        } else {
            constants['SKY_VIEW_LUT_RES_X'] = lutRenderer.resources.skyViewLut.texture.width;
            constants['SKY_VIEW_LUT_RES_Y'] = lutRenderer.resources.skyViewLut.texture.height;
            module = device.createShaderModule({
                code: `${config.shadow?.wgslCode || 'fn get_shadow(p: vec3<f32>, i: u32) -> f32 { return 1.0; }'}\n${makeRenderSkyLutAndRaymarchingShaderCode(config.skyRenderer.renderTarget.texture.format, config.customUniformsSource?.wgslCode)}`,
            });
        }

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
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static async createAsync(device: GPUDevice, config: SkyAtmosphereComputeRendererConfig, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources): Promise<SkyAtmosphereComputeRenderer> {
        const rayMarchDistantSky = config.skyRenderer.rayMarch?.rayMarchDistantSky ?? true;
        const lutRenderer = await super.createAsync(device, config, existingPipelines, existingResources);
        const [renderSkyWithLutsBindGroupLayout, renderSkyRaymarchingBindGroupLayout] = this.makeBindGroupLayouts(device, config, lutRenderer.resources, rayMarchDistantSky);
        const [renderSkyWithLutsPipeline, renderSkyRaymarchingPipeline] = await Promise.all([
            device.createComputePipelineAsync(this.makeWithLutsPiplelineDescriptor(device, config, lutRenderer, renderSkyWithLutsBindGroupLayout)),
            device.createComputePipelineAsync(this.makeRayMarchPipelineDescriptor(device, config, lutRenderer, renderSkyRaymarchingBindGroupLayout, rayMarchDistantSky)),
        ]);
        return new SkyAtmosphereComputeRenderer(
            lutRenderer,
            renderSkyWithLutsBindGroupLayout,
            renderSkyRaymarchingBindGroupLayout,
            rayMarchDistantSky,
            renderSkyWithLutsPipeline,
            renderSkyRaymarchingPipeline,
            config,
        );
    }

    /**
     * Creates a {@link SkyAtmosphereComputeRenderer}.
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static create(device: GPUDevice, config: SkyAtmosphereComputeRendererConfig, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources): SkyAtmosphereComputeRenderer {
        const rayMarchDistantSky = config.skyRenderer.rayMarch?.rayMarchDistantSky ?? true;
        const lutRenderer = super.create(device, config, existingPipelines, existingResources);
        const [renderSkyWithLutsBindGroupLayout, renderSkyRaymarchingBindGroupLayout] = this.makeBindGroupLayouts(device, config, lutRenderer.resources, rayMarchDistantSky);
        const [renderSkyWithLutsPipeline, renderSkyRaymarchingPipeline] = [
            device.createComputePipeline(this.makeWithLutsPiplelineDescriptor(device, config, lutRenderer, renderSkyWithLutsBindGroupLayout)),
            device.createComputePipeline(this.makeRayMarchPipelineDescriptor(device, config, lutRenderer, renderSkyRaymarchingBindGroupLayout, rayMarchDistantSky)),
        ];
        return new SkyAtmosphereComputeRenderer(
            lutRenderer,
            renderSkyWithLutsBindGroupLayout,
            renderSkyRaymarchingBindGroupLayout,
            rayMarchDistantSky,
            renderSkyWithLutsPipeline,
            renderSkyRaymarchingPipeline,
            config,
        );
    }


    private makeBindGroups(config: SkyAtmosphereComputeRendererResizeConfig): [GPUBindGroup, GPUBindGroup] {
        const renderSkyBindGroupBaseEntries: GPUBindGroupEntry[] = [
            {
                binding: 0,
                resource: {
                    buffer: this.resources.atmosphereBuffer,
                },
            },
            this.usesCustomUniforms ? undefined : {
                binding: 1,
                resource: {
                    buffer: this.resources.uniformsBuffer,
                },
            },
            {
                binding: 2,
                resource: this.resources.lutSampler,
            },
            {
                binding: 3,
                resource: this.resources.transmittanceLut.view,
            },
        ].filter(e => e !== undefined) as GPUBindGroupEntry[];
        const externalResourcesBindGroupEntries = [
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
        return [
            this.resources.device.createBindGroup({
                label: `Render sky with LUTs bind group [${this.resources.label}]`,
                layout: this.renderSkyWithLutsBindGroupLayout,
                entries: [
                    ...renderSkyBindGroupBaseEntries,
                    {
                        binding: 4,
                        resource: this.resources.skyViewLut.view,
                    },
                    {
                        binding: 5,
                        resource: this.resources.aerialPerspectiveLut.view,
                    },
                    ...externalResourcesBindGroupEntries,
                ].map((v, i) => {
                    v.binding = i;
                    return v;
                }) as GPUBindGroupEntry[],
            }),
            this.rayMarchDistantSky ?
                this.resources.device.createBindGroup({
                    label: `Render sky raymarching bind group [${this.resources.label}]`,
                    layout: this.renderSkyRaymarchingBindGroupLayout,
                    entries: [
                        ...renderSkyBindGroupBaseEntries,
                        {
                            binding: 4,
                            resource: this.resources.multiScatteringLut.view,
                        },
                        ...externalResourcesBindGroupEntries,
                    ].map((v, i) => {
                        v.binding = i;
                        return v;
                    }) as GPUBindGroupEntry[],
                }) :
                this.resources.device.createBindGroup({
                    label: `Render sky lut + raymarching bind group [${this.resources.label}]`,
                    layout: this.renderSkyRaymarchingBindGroupLayout,
                    entries: [
                        ...renderSkyBindGroupBaseEntries,
                        {
                            binding: 4,
                            resource: this.resources.multiScatteringLut.view,
                        },
                        {
                            binding: 5,
                            resource: this.resources.skyViewLut.view,
                        },
                        ...externalResourcesBindGroupEntries,
                    ].map((v, i) => {
                        v.binding = i;
                        return v;
                    }) as GPUBindGroupEntry[],
                }),
        ];
    }

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
        const [withLutsBindGroup, rayMarchingBindGroup] = this.makeBindGroups(config);
        this.renderSkyWithLutsPass.replaceBindGroup(0, withLutsBindGroup);
        this.renderSkyRaymarchingPass.replaceBindGroup(0, rayMarchingBindGroup);

        const dispatchDimensions: [number, number, number] = [
            Math.ceil(size[0] / 16.0),
            Math.ceil(size[1] / 16.0),
            1,
        ];
        this.renderSkyWithLutsPass.replaceDispatchDimensions(dispatchDimensions);
        this.renderSkyRaymarchingPass.replaceDispatchDimensions(dispatchDimensions);
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
        this.renderSkyWithLutsPass.encode(passEncoder);
    }

    /**
     * Renders the sky / atmosphere using full-screen ray marching.
     *
     * Requires the transmittance and multiple scattering lookup tables to be initialized.
     * Either initialize these lookup tables in the constructor using {@link SkyAtmosphereRendererConfig.initializeConstantLuts}, or call {@link renderConstantLuts}.
     *
     * @param passEncoder A `GPUComputePassEncoder` to encode the pass with. Can be the same encoder used to initialize the transmittance and multiple scattering lookup tables. The encoder is not `end()`ed by this function.
     *
     * @see {@link renderConstantLuts}: To initialize the lookup tables required, call this function.
     */
    public renderSkyRaymarching(passEncoder: GPUComputePassEncoder) {
        this.renderSkyRaymarchingPass.encode(passEncoder);
    }

    /**
     * Renders the sky / atmosphere using either lookup tables or full-screen ray marching, as well as all look up tables required by the respective approach.
     *
     * @param passEncoder A `GPUComputePassEncoder` to encode the sky / atmosphere rendering pass with. The encoder is not `end()`ed by this function.
     * @param useFullScreenRayMarch If this is true, full-screen ray marching will be used to render the sky / atmosphere. Defaults to {@link defaultToPerPixelRayMarch}.
     *
     * @see {@link renderSkyWithLuts}: Called internally, if rendering the sky with lookup tables.
     * @see {@link renderSkyRaymarching}: Called internally, if rendering the sky with full-screen ray marching.
     */
    public renderSky(passEncoder: GPUComputePassEncoder, useFullScreenRayMarch?: boolean) {
        if (useFullScreenRayMarch ?? this.defaultToPerPixelRayMarch) {
            this.renderSkyRaymarching(passEncoder);
        } else {
            this.renderSkyWithLuts(passEncoder);
        }
    }

    /**
     * Renders the sky / atmosphere using either lookup tables or full-screen ray marching, as well as all look up tables required by the respective approach.
     *
     * To initialize or update the transmittance and multiple scattering lookup tables, pass new {@link Atmosphere} paramters to this function or use the `forceConstantLutRendering` parameter.
     *
     * @param passEncoder A `GPUComputePassEncoder` to encode passes with. The encoder is not `end()`ed by this function.
     * @param uniforms {@link Uniforms} to use for this frame. If this is given, the internal uniform buffer will be updated using {@link updateUniforms}.
     * @param atmosphere {@link Atmosphere} parameters to use for this frame. If this is given, the internal uniform buffer storing the {@link Atmosphere} parameters will be updated and the transmittance and multiple scattering lookup tables will be rendered.
     * @param useFullScreenRayMarch If this is true, full-screen ray marching will be used to render the sky / atmosphere. In that case, the sky view and aerial perspective lookup tables will not be rendered. Defaults to {@link defaultToPerPixelRayMarch}.
     * @param forceConstantLutRendering If this is true, the transmittance and multiple scattering lookup tables will be rendered regardless of whether the `atmosphere` parameter is `undefined` or not.
     *
     * @see {@link renderConstantLuts}: Called internally, if either `atmosphere` is defined or `forceConstantLutRendering` is true.
     * @see {@link updateUniforms}: Called internally, if full-screen ray marching is used and the `uniforms` parameter is not undefined.
     * @see {@link renderSkyViewLut}: Called internally, if full-screen ray-marching is used but the distant sky is not ray marched.
     * @see {@link renderSkyRaymarching}: Called internally, if full-screen ray-marching is used.
     * @see {@link renderDynamicLuts}: Called internally, if the sky / atmosphere is rendered using lookup tables.
     * @see {@link renderSkyWithLuts}: Called internally, if the sky / atmosphere is rendered using lookup tables.
     */
    public renderSkyAtmosphere(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms, atmosphere?: Atmosphere, useFullScreenRayMarch?: boolean, forceConstantLutRendering?: boolean) {
        if (atmosphere || (forceConstantLutRendering ?? false)) {
            this.renderConstantLuts(passEncoder, atmosphere);
        }
        if (useFullScreenRayMarch ?? this.defaultToPerPixelRayMarch) {
            if (uniforms) {
                this.updateUniforms(uniforms);
            }
            if (!this.rayMarchDistantSky) {
                this.renderSkyViewLut(passEncoder);
            }
            this.renderSkyRaymarching(passEncoder);
        } else {
            this.renderDynamicLuts(passEncoder, uniforms);
            this.renderSkyWithLuts(passEncoder);
        }
    }
}

/**
 * A {@link SkyAtmosphereRenderer} that uses `GPURenderPipeline`s to render the sky / atmosphere.
 */
export class SkyAtmosphereRasterRenderer extends SkyAtmosphereRenderer {
    private renderSkyWithLutsPass: RenderPass;
    private renderSkyWithLutsBundle?: GPURenderBundle;

    private renderSkyRaymarchingPass: RenderPass;
    private renderSkyRaymarchingBundle?: GPURenderBundle;

    private constructor(
        lutRenderer: SkyAtmosphereRenderer,
        private renderSkyWithLutsBindGroupLayout: GPUBindGroupLayout,
        private renderSkyRaymarchingBindGroupLayout: GPUBindGroupLayout,
        private renderSkyWithLutsTargetFormats: GPUTextureFormat[],
        private renderSkyRaymarchingTargetFormats: GPUTextureFormat[],
        private rayMarchDistantSky: boolean,
        withLutsPipeline: GPURenderPipeline,
        rayMarchPipeline: GPURenderPipeline,
        config: SkyAtmosphereRasterRendererConfig,
    ) {
        super(lutRenderer);

        const [withLutsBindGroup, rayMarchingBindGroup] = this.makeBindGroups(
            config.skyRenderer.depthBuffer.view ?? config.skyRenderer.depthBuffer.texture,
        );

        this.renderSkyWithLutsPass = new RenderPass(
            withLutsPipeline,
            [withLutsBindGroup, ...(config.customUniformsSource?.bindGroups ?? [])],
        );

        this.renderSkyRaymarchingPass = new RenderPass(
            rayMarchPipeline,
            [
                rayMarchingBindGroup,
                ...(config.shadow?.bindGroups ?? []),
                ...(config.customUniformsSource?.bindGroups ?? []),
            ],
        );

        if (config.skyRenderer.recordInternalRenderBundles ?? true) {
            [this.renderSkyWithLutsBundle, this.renderSkyRaymarchingBundle] = this.recordBundles();
        }
    }

    private static makeBindGroupLayouts(device: GPUDevice, config: SkyAtmosphereRasterRendererConfig, resources: SkyAtmosphereResources, rayMarchDistantSky: boolean): [GPUBindGroupLayout, GPUBindGroupLayout] {
        const renderSkyBindGroupLayoutBaseEntries: GPUBindGroupLayoutEntry[] = [
            {
                binding: 0,
                visibility: GPUShaderStage.FRAGMENT,
                buffer: {
                    type: 'uniform',
                    hasDynamicOffset: false,
                    minBindingSize: ATMOSPHERE_BUFFER_SIZE,
                },
            },
            config.customUniformsSource ? undefined : {
                binding: 1,
                visibility: GPUShaderStage.FRAGMENT,
                buffer: {
                    type: 'uniform',
                    hasDynamicOffset: false,
                    minBindingSize: UNIFORMS_BUFFER_SIZE,
                },
            },
            {
                binding: 2,
                visibility: GPUShaderStage.FRAGMENT,
                sampler: {
                    type: 'filtering',
                },
            },
            {
                binding: 3,
                visibility: GPUShaderStage.FRAGMENT,
                texture: {
                    sampleType: 'float',
                    viewDimension: resources.transmittanceLut.texture.dimension,
                    multisampled: false,
                },
            },
        ].filter(e => e !== undefined) as GPUBindGroupLayoutEntry[];
        const externalResourcesLayoutEntries: GPUBindGroupLayoutEntry[] = [
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

        return [
            device.createBindGroupLayout({
                label: `Render sky with luts bind group layout [${resources.label}]`,
                entries: [
                    ...renderSkyBindGroupLayoutBaseEntries,
                    {
                        binding: 4,
                        visibility: GPUShaderStage.FRAGMENT,
                        texture: {
                            sampleType: 'float',
                            viewDimension: resources.skyViewLut.texture.dimension,
                            multisampled: false,
                        },
                    },
                    {
                        binding: 5,
                        visibility: GPUShaderStage.FRAGMENT,
                        texture: {
                            sampleType: 'float',
                            viewDimension: resources.aerialPerspectiveLut.texture.dimension,
                            multisampled: false,
                        },
                    },
                    ...externalResourcesLayoutEntries,
                ].map((v, i) => {
                    v.binding = i;
                    return v;
                }) as GPUBindGroupLayoutEntry[],
            }),
            device.createBindGroupLayout({
                label: `Render sky raymarching bind group layout [${resources.label}]`,
                entries: ([
                        ...renderSkyBindGroupLayoutBaseEntries,
                        {
                            binding: 4,
                            visibility: GPUShaderStage.FRAGMENT,
                            texture: {
                                sampleType: 'float',
                                viewDimension: resources.multiScatteringLut.texture.dimension,
                                multisampled: false,
                            },
                        },
                        rayMarchDistantSky ? undefined : {
                            binding: 5,
                            visibility: GPUShaderStage.FRAGMENT,
                            texture: {
                                sampleType: 'float',
                                viewDimension: resources.skyViewLut.texture.dimension,
                                multisampled: false,
                            },
                        },
                        ...externalResourcesLayoutEntries,
                    ].filter(e => e !== undefined) as GPUBindGroupLayoutEntry[])
                    .map((v, i) => {
                        v.binding = i;
                        return v;
                    }) as GPUBindGroupLayoutEntry[],
            }),
        ];
    }

    private static makeBlendStates() {
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

    private static makeWithLutsPiplelineDescriptor(device: GPUDevice, config: SkyAtmosphereRasterRendererConfig, lutRenderer: SkyAtmosphereRenderer, renderSkyWithLutsBindGroupLayout: GPUBindGroupLayout, blendState: GPUBlendState, dualBlendState: GPUBlendState, useDualSourceBlending: boolean): [GPURenderPipelineDescriptor, GPUTextureFormat[]] {
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
                        renderSkyWithLutsBindGroupLayout,
                        ...(config.customUniformsSource?.bindGroupLayouts ?? []),
                    ],
                }),
                vertex: {
                    module,
                },
                fragment: {
                    module,
                    constants: {
                        AP_SLICE_COUNT: lutRenderer.resources.aerialPerspectiveLut.texture.depthOrArrayLayers,
                        AP_DISTANCE_PER_SLICE: lutRenderer.skyAtmospherePipelines.aerialPerspectiveLutPipeline.aerialPerspectiveDistancePerSlice,
                        AP_INV_DISTANCE_PER_SLICE: lutRenderer.skyAtmospherePipelines.aerialPerspectiveLutPipeline.aerialPerspectiveInvDistancePerSlice,
                        SKY_VIEW_LUT_RES_X: lutRenderer.resources.skyViewLut.texture.width,
                        SKY_VIEW_LUT_RES_Y: lutRenderer.resources.skyViewLut.texture.height,
                        IS_REVERSE_Z: Number(config.skyRenderer.depthBuffer.reverseZ ?? false),
                        RENDER_SUN_DISK: Number(config.lights?.renderSunDisk ?? true),
                        RENDER_MOON_DISK: Number(config.lights?.renderMoonDisk ?? (config.lights?.useMoon ?? false)),
                        LIMB_DARKENING_ON_SUN: Number(config.lights?.applyLimbDarkeningOnSun ?? true),
                        LIMB_DARKENING_ON_MOON: Number(config.lights?.applyLimbDarkeningOnMoon ?? false),
                        USE_MOON: Number(config.lights?.useMoon ?? false),
                    },
                    targets,
                },
            },
            targets.map(t => t.format),
        ];
    }

    private static makeRayMarchPipelineDescriptor(device: GPUDevice, config: SkyAtmosphereRasterRendererConfig, lutRenderer: SkyAtmosphereRenderer, renderSkyRaymarchingBindGroupLayout: GPUBindGroupLayout, rayMarchDistantSky: boolean, blendState: GPUBlendState, dualBlendState: GPUBlendState, useDualSourceBlending: boolean): [GPURenderPipelineDescriptor, GPUTextureFormat[]] {
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

            let code = rayMarchDistantSky ?
                makeRenderSkyRaymarchingShaderCode('rgba16float', config.customUniformsSource?.wgslCode) :
                makeRenderSkyLutAndRaymarchingShaderCode('rgba16float', config.customUniformsSource?.wgslCode);
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
                code: `${useDualSourceBlending ? 'enable dual_source_blending;\n' : ''}${config.shadow?.wgslCode || 'fn get_shadow(p: vec3<f32>, i: u32) -> f32 { return 1.0; }'}\n${code}`,
            });

            const constants: Record<string, GPUPipelineConstantValue> = {
                INV_DISTANCE_TO_MAX_SAMPLE_COUNT: 1.0 / (config.skyRenderer.distanceToMaxSampleCount ?? (100.0 * (config.distanceScaleFactor ?? 1.0))),
                RANDOMIZE_SAMPLE_OFFSET: Number(config.skyRenderer.rayMarch?.randomizeRayOffsets ?? true),
                MULTI_SCATTERING_LUT_RES_X: lutRenderer.resources.multiScatteringLut.texture.width,
                MULTI_SCATTERING_LUT_RES_Y: lutRenderer.resources.multiScatteringLut.texture.height,
                IS_REVERSE_Z: Number(config.skyRenderer.depthBuffer.reverseZ ?? false),
                RENDER_SUN_DISK: Number(config.lights?.renderSunDisk ?? true),
                RENDER_MOON_DISK: Number(config.lights?.renderMoonDisk ?? (config.lights?.useMoon ?? false)),
                LIMB_DARKENING_ON_SUN: Number(config.lights?.applyLimbDarkeningOnSun ?? true),
                LIMB_DARKENING_ON_MOON: Number(config.lights?.applyLimbDarkeningOnMoon ?? false),
                USE_MOON: Number(config.lights?.useMoon ?? false),
            };

            if (!rayMarchDistantSky) {
                constants['SKY_VIEW_LUT_RES_X'] = lutRenderer.resources.skyViewLut.texture.width;
                constants['SKY_VIEW_LUT_RES_Y'] = lutRenderer.resources.skyViewLut.texture.height;
            }

            return [
                {
                    label: `Render sky raymarching pipeline [${lutRenderer.resources.label}]`,
                    layout: device.createPipelineLayout({
                        label: `Render sky raymarching pipeline layout [${lutRenderer.resources.label}]`,
                        bindGroupLayouts: [
                            renderSkyRaymarchingBindGroupLayout,
                            ...(config.shadow?.bindGroupLayouts || []),
                            ...(config.customUniformsSource?.bindGroupLayouts ?? []),
                        ],
                    }),
                    vertex: {
                        module,
                    },
                    fragment: {
                        module,
                        constants,
                        targets,
                    },
                },
                targets.map(t => t.format),
            ];
    }

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
    static async createAsync(device: GPUDevice, config: SkyAtmosphereRasterRendererConfig, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources): Promise<SkyAtmosphereRasterRenderer> {
        const useDualSourceBlending = device.features.has('dual-source-blending') && (config.skyRenderer.rayMarch?.useColoredTransmittance ?? false);
        if (!useDualSourceBlending && config.skyRenderer.rayMarch?.useColoredTransmittance) {
            console.warn('[SkyAtmosphereRenderer]: dual source blending was requested but the device feature is not enabled');
        }

        const rayMarchDistantSky = config.skyRenderer.rayMarch?.rayMarchDistantSky ?? true;
        const lutRenderer = await super.createAsync(device, config, existingPipelines, existingResources);
        const [renderSkyWithLutsBindGroupLayout, renderSkyRaymarchingBindGroupLayout] = this.makeBindGroupLayouts(device, config, lutRenderer.resources, rayMarchDistantSky);
        const blendStates = this.makeBlendStates();
        const [withLutsDescriptor, withLutsFormats] = this.makeWithLutsPiplelineDescriptor(device, config, lutRenderer, renderSkyWithLutsBindGroupLayout, blendStates.single, blendStates.dual, useDualSourceBlending);
        const [rayMarchDescriptor, rayMarchFormats] = this.makeRayMarchPipelineDescriptor(device, config, lutRenderer, renderSkyRaymarchingBindGroupLayout, rayMarchDistantSky, blendStates.single, blendStates.dual, useDualSourceBlending);
        const [renderSkyWithLutsPipeline, renderSkyRaymarchingPipeline] = await Promise.all([
            device.createRenderPipelineAsync(withLutsDescriptor),
            device.createRenderPipelineAsync(rayMarchDescriptor),
        ]);

        return new SkyAtmosphereRasterRenderer(
            lutRenderer,
            renderSkyWithLutsBindGroupLayout,
            renderSkyRaymarchingBindGroupLayout,
            withLutsFormats,
            rayMarchFormats,
            rayMarchDistantSky,
            renderSkyWithLutsPipeline,
            renderSkyRaymarchingPipeline,
            config,
        );
    }

    /**
     * Creates a {@link SkyAtmosphereRasterRenderer}.
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static create(device: GPUDevice, config: SkyAtmosphereRasterRendererConfig, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources): SkyAtmosphereRasterRenderer {
        const useDualSourceBlending = device.features.has('dual-source-blending') && (config.skyRenderer.rayMarch?.useColoredTransmittance ?? false);
        if (!useDualSourceBlending && config.skyRenderer.rayMarch?.useColoredTransmittance) {
            console.warn('[SkyAtmosphereRenderer]: dual source blending was requested but the device feature is not enabled');
        }

        const rayMarchDistantSky = config.skyRenderer.rayMarch?.rayMarchDistantSky ?? true;
        const lutRenderer = super.create(device, config, existingPipelines, existingResources);
        const [renderSkyWithLutsBindGroupLayout, renderSkyRaymarchingBindGroupLayout] = this.makeBindGroupLayouts(device, config, lutRenderer.resources, rayMarchDistantSky);
        const blendStates = this.makeBlendStates();
        const [withLutsDescriptor, withLutsFormats] = this.makeWithLutsPiplelineDescriptor(device, config, lutRenderer, renderSkyWithLutsBindGroupLayout, blendStates.single, blendStates.dual, useDualSourceBlending);
        const [rayMarchDescriptor, rayMarchFormats] = this.makeRayMarchPipelineDescriptor(device, config, lutRenderer, renderSkyRaymarchingBindGroupLayout, rayMarchDistantSky, blendStates.single, blendStates.dual, useDualSourceBlending);
        const [renderSkyWithLutsPipeline, renderSkyRaymarchingPipeline] = [
            device.createRenderPipeline(withLutsDescriptor),
            device.createRenderPipeline(rayMarchDescriptor),
        ];

        return new SkyAtmosphereRasterRenderer(
            lutRenderer,
            renderSkyWithLutsBindGroupLayout,
            renderSkyRaymarchingBindGroupLayout,
            withLutsFormats,
            rayMarchFormats,
            rayMarchDistantSky,
            renderSkyWithLutsPipeline,
            renderSkyRaymarchingPipeline,
            config,
        );
    }

    private makeBindGroups(depthBuffer: GPUTextureView | GPUTexture): [GPUBindGroup, GPUBindGroup] {
        const renderSkyBindGroupBaseEntries: GPUBindGroupEntry[] = [
            {
                binding: 0,
                resource: {
                    buffer: this.resources.atmosphereBuffer,
                },
            },
            this.usesCustomUniforms ? undefined : {
                binding: 1,
                resource: {
                    buffer: this.resources.uniformsBuffer,
                },
            },
            {
                binding: 2,
                resource: this.resources.lutSampler,
            },
            {
                binding: 3,
                resource: this.resources.transmittanceLut.view,
            },
        ].filter(e => e !== undefined) as GPUBindGroupEntry[];
        const externalResourcesBindGroupEntries: GPUBindGroupEntry[] = [
            {
                binding: 6,
                resource: depthBuffer instanceof GPUTextureView ? depthBuffer : depthBuffer.createView(depthBuffer.format.includes('depth') ? {
                    aspect: 'depth-only',
                } : {}),
            },
        ];
        return [
            this.resources.device.createBindGroup({
                label: `Render sky with LUTs bind group [${this.resources.label}]`,
                layout: this.renderSkyWithLutsBindGroupLayout,
                entries: [
                    ...renderSkyBindGroupBaseEntries,
                    {
                        binding: 4,
                        resource: this.resources.skyViewLut.view,
                    },
                    {
                        binding: 5,
                        resource: this.resources.aerialPerspectiveLut.view,
                    },
                    ...externalResourcesBindGroupEntries,
                ].map((v, i) => {
                    v.binding = i;
                    return v;
                }) as GPUBindGroupEntry[],
            }),
            this.rayMarchDistantSky ?
                this.resources.device.createBindGroup({
                    label: `Render sky raymarching bind group [${this.resources.label}]`,
                    layout: this.renderSkyRaymarchingBindGroupLayout,
                    entries: [
                        ...renderSkyBindGroupBaseEntries,
                        {
                            binding: 4,
                            resource: this.resources.multiScatteringLut.view,
                        },
                        ...externalResourcesBindGroupEntries,
                    ].map((v, i) => {
                        v.binding = i;
                        return v;
                    }) as GPUBindGroupEntry[],
                }) :
                this.resources.device.createBindGroup({
                    label: `Render sky raymarching bind group [${this.resources.label}]`,
                    layout: this.renderSkyRaymarchingBindGroupLayout,
                    entries: [
                        ...renderSkyBindGroupBaseEntries,
                        {
                            binding: 4,
                            resource: this.resources.multiScatteringLut.view,
                        },
                        {
                            binding: 5,
                            resource: this.resources.skyViewLut.view,
                        },
                        ...externalResourcesBindGroupEntries,
                    ].map((v, i) => {
                        v.binding = i;
                        return v;
                    }) as GPUBindGroupEntry[],
                }),
        ];
    }

    private recordBundles(): [GPURenderBundle, GPURenderBundle] {
        const withLutsEncoder = this.resources.device.createRenderBundleEncoder({
            label: 'Render sky with LUTs',
            colorFormats: this.renderSkyWithLutsTargetFormats,
        });
        this.renderSkyWithLuts(withLutsEncoder);
        const renderSkyWithLutsBundle = withLutsEncoder.finish();

        const rayMarchEncoder = this.resources.device.createRenderBundleEncoder({
            label: 'Render sky with LUTs',
            colorFormats: this.renderSkyRaymarchingTargetFormats,
        });
        this.renderSkyRaymarching(rayMarchEncoder);
        const renderSkyRaymarchingBundle = rayMarchEncoder.finish();

        return [renderSkyWithLutsBundle, renderSkyRaymarchingBundle];
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
        const [withLutsBindGroup, rayMarchingBindGroup] = this.makeBindGroups(depthBuffer);
        this.renderSkyWithLutsPass.replaceBindGroup(0, withLutsBindGroup);
        this.renderSkyRaymarchingPass.replaceBindGroup(0, rayMarchingBindGroup);

        if (this.renderSkyWithLutsBundle && this.renderSkyRaymarchingBundle) {
            [this.renderSkyWithLutsBundle, this.renderSkyRaymarchingBundle] = this.recordBundles();
        }
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
        if (passEncoder instanceof GPURenderPassEncoder && this.renderSkyWithLutsBundle) {
            passEncoder.executeBundles([this.renderSkyWithLutsBundle]);
        } else {
            this.renderSkyWithLutsPass.encode(passEncoder);
        }
    }

    /**
     * Renders the sky / atmosphere using full-screen ray marching.
     *
     * Requires the transmittance and multiple scattering lookup tables to be initialized.
     * Either initialize these lookup tables in the constructor using {@link SkyAtmosphereRendererConfig.initializeConstantLuts}, or call {@link renderConstantLuts}.
     *
     * @param passEncoder A `GPURenderPassEncoder` or `GPURenderBundleEncoder` to encode the pass with. The encoder is not `end()`ed by this function.
     *
     * @see {@link renderConstantLuts}: To initialize the lookup tables required, call this function.
     */
    public renderSkyRaymarching(passEncoder: GPURenderPassEncoder | GPURenderBundleEncoder) {
        if (passEncoder instanceof GPURenderPassEncoder && this.renderSkyRaymarchingBundle) {
            passEncoder.executeBundles([this.renderSkyRaymarchingBundle]);
        } else {
            this.renderSkyRaymarchingPass.encode(passEncoder);
        }
    }

    /**
     * Renders the sky / atmosphere using either lookup tables or full-screen ray marching, as well as all look up tables required by the respective approach.
     *
     * @param passEncoder A `GPURenderPassEncoder` or `GPURenderBundleEncoder` to encode the sky / atmosphere rendering pass with. The encoder is not `end()`ed by this function.
     * @param useFullScreenRayMarch If this is true, full-screen ray marching will be used to render the sky / atmosphere. Defaults to {@link defaultToPerPixelRayMarch}.
     *
     * @see {@link renderSkyWithLuts}: Called internally, if rendering the sky with lookup tables.
     * @see {@link renderSkyRaymarching}: Called internally, if rendering the sky with full-screen ray marching.
     */
    public renderSky(passEncoder: GPURenderPassEncoder | GPURenderBundleEncoder, useFullScreenRayMarch?: boolean) {
        if (useFullScreenRayMarch ?? this.defaultToPerPixelRayMarch) {
            this.renderSkyRaymarching(passEncoder);
        } else {
            this.renderSkyWithLuts(passEncoder);
        }
    }

        /**
     * Renders the lookup tables required for rendering the sky / atmosphere.
     *
     * To initialize or update the transmittance and multiple scattering lookup tables, pass new {@link Atmosphere} paramters to this function or use the `forceConstantLutRendering` parameter.
     *
     * @param passEncoder A `GPUComputePassEncoder` to encode passes with. The encoder is not `end()`ed by this function.
     * @param uniforms {@link Uniforms} to use for this frame. If this is given, the internal uniform buffer will be updated using {@link updateUniforms}.
     * @param atmosphere {@link Atmosphere} parameters to use for this frame. If this is given, the internal uniform buffer storing the {@link Atmosphere} parameters will be updated and the transmittance and multiple scattering lookup tables will be rendered.
     * @param useFullScreenRayMarch If this is true, the sky view and aerial perspective lookup tables will not be rendered. Defaults to {@link defaultToPerPixelRayMarch}.
     * @param forceConstantLutRendering If this is true, the transmittance and multiple scattering lookup tables will be rendered regardless of whether the `atmosphere` parameter is `undefined` or not.
     *
     * @see {@link renderConstantLuts}: Called internally, if either `atmosphere` is defined or `forceConstantLutRendering` is true.
     * @see {@link updateUniforms}: Called internally, if full-screen ray marching is used and the `uniforms` parameter is not undefined.
     * @see {@link renderDynamicLuts}: Called internally, if the the `useFullScreenRayMarch` is true or if it is undefined and {@link defaultToPerPixelRayMarch} is true.
     */
    public override renderSkyAtmosphereLuts(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms, atmosphere?: Atmosphere, useFullScreenRayMarch?: boolean, forceConstantLutRendering?: boolean) {
        super.renderSkyAtmosphereLuts(passEncoder, uniforms, atmosphere, useFullScreenRayMarch, forceConstantLutRendering);
        if ((useFullScreenRayMarch ?? false) && !this.rayMarchDistantSky) {
            this.renderSkyViewLut(passEncoder);
        }
    }
}

