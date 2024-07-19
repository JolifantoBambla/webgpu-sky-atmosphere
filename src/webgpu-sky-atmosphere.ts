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
    DepthBufferConfig,
    MultiScatteringLutConfig,
    ShadowConfig,
    SkyAtmosphereLutConfig,
    SkyAtmosphereConfig,
    SkyRendererComputePassConfig,
    SkyRendererPassConfig,
    SkyRenderPassConfig,
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
    DepthBufferConfig,
    MultiScatteringLutConfig,
    ShadowConfig,
    SkyAtmosphereLutConfig,
    SkyAtmosphereConfig,
    SkyRendererComputePassConfig,
    SkyRendererPassConfig,
    SkyRenderPassConfig,
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

function isComputePassConfig(passConfig: SkyRendererComputePassConfig | SkyRenderPassConfig): passConfig is SkyRendererComputePassConfig {
    return (passConfig as SkyRendererComputePassConfig).backBuffer !== undefined;
}

export class SkyAtmosphereRenderer {
    readonly resources: SkyAtmosphereResources;

    readonly skyAtmospherePipelines: SkyAtmospherePipelines;

    public defaultToPerPixelRayMarch: boolean;

    private transmittanceLutPass: ComputePass;
    private multiScatteringLutPass: ComputePass;
    private skyViewLutPass: ComputePass;
    private aerialPerspectiveLutPass: ComputePass;

    /**
     * Creates a {@link SkyAtmosphereRenderer}.
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereConfig} used to configure internal resources and behavior.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereConfig}. Especially, {@link SkyAtmosphereConfig.lookUpTables} and {@link SkyAtmosphereConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    constructor(device: GPUDevice, config: SkyAtmosphereConfig, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources) {
        if ((existingPipelines?.transmittanceLutPipeline.device || device) !== device) {
            this.skyAtmospherePipelines = new SkyAtmospherePipelines(device, config);
        } else {
            this.skyAtmospherePipelines = existingPipelines || new SkyAtmospherePipelines(device, config);
        }

        this.defaultToPerPixelRayMarch = config.skyRenderer.defaultToPerPixelRayMarch ?? false;

        this.resources = existingResources || new SkyAtmosphereResources(device, config);

        this.transmittanceLutPass = this.skyAtmospherePipelines.transmittanceLutPipeline.makeComputePass(this.resources);
        this.multiScatteringLutPass = this.skyAtmospherePipelines.multiScatteringLutPipeline.makeComputePass(this.resources);
        this.skyViewLutPass = this.skyAtmospherePipelines.skyViewLutPipeline.makeComputePass(this.resources, (config.lookUpTables?.skyViewLut?.affectedByShadow ?? true) ? config.shadow?.bindGroups : undefined,);
        this.aerialPerspectiveLutPass = this.skyAtmospherePipelines.aerialPerspectiveLutPipeline.makeComputePass(this.resources, config.shadow?.bindGroups);

        if (config.initializeConstantLuts ?? true) {
            const commandEncoder = device.createCommandEncoder();
            const computePassEncoder = commandEncoder.beginComputePass();
            this.renderConstantLuts(computePassEncoder);
            computePassEncoder.end();
            device.queue.submit([commandEncoder.finish()]);
        }
    }

    /**
     * Creates a new instance of a {@link SkyAtmosphereComputeRenderer} or a {@link SkyAtmosphereRasterRenderer}, depending on the {@link SkyRendererPassConfig} given as part of the {@link SkyAtmosphereConfig}.
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereConfig} used to configure internal resources and behavior. Determines if a {@link SkyAtmosphereComputeRenderer} or a {@link SkyAtmosphereRasterRenderer} is returned.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereConfig}. Especially, {@link SkyAtmosphereConfig.lookUpTables} and {@link SkyAtmosphereConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     * @returns Returns a {@link SkyAtmosphereComputeRenderer} or a {@link SkyAtmosphereRasterRenderer}, depending on the {@link SkyRendererPassConfig} given as part of the {@link SkyAtmosphereConfig}.
     */
    public static makeSkyAtmosphereRenderer(device: GPUDevice, config: SkyAtmosphereConfig, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources): SkyAtmosphereComputeRenderer | SkyAtmosphereRasterRenderer {
        if (isComputePassConfig(config.skyRenderer.passConfig)) {
            return new SkyAtmosphereComputeRenderer(device, config, existingPipelines, existingResources);
        } else {
            return new SkyAtmosphereRasterRenderer(device, config, existingPipelines, existingResources);
        }
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
     * @see {@link SkyAtmosphereResources.updateUniforms}: Called internally to update the {@link Uniforms}.
     */
    public updateUniforms(uniforms: Uniforms) {
        this.resources.updateUniforms(uniforms);
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
     * If (a) user-defined shadow map(s) is used (see {@link SkyAtmosphereConfig.shadow}), make sure to encode any updates of the shadow map(s) before encoding this pass.
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
     * If (a) user-defined shadow map(s) is used (see {@link SkyAtmosphereConfig.shadow}), make sure to encode any updates of the shadow map(s) before encoding this pass.
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
        if (useFullScreenRayMarch ?? this.defaultToPerPixelRayMarch) {
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
    private renderSkyWithLutsBindGroupLayout: GPUBindGroupLayout;
    private renderSkyWithLutsPass: ComputePass;
    private renderSkyRaymarchingBindGroupLayout: GPUBindGroupLayout;
    private renderSkyRaymarchingPass: ComputePass;

    /**
     * Creates a {@link SkyAtmosphereComputeRenderer}.
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereConfig} used to configure internal resources and behavior.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereConfig}. Especially, {@link SkyAtmosphereConfig.lookUpTables} and {@link SkyAtmosphereConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    constructor(device: GPUDevice, config: SkyAtmosphereConfig, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources) {
        super(device, config, existingPipelines, existingResources);
        if (isComputePassConfig(config.skyRenderer.passConfig)) {
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
                {
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
            ];
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
                        viewDimension: config.skyRenderer.passConfig.backBuffer.texture.dimension,
                        multisampled: false,
                    },
                },
                {
                    binding: 7,
                    visibility: GPUShaderStage.COMPUTE,
                    storageTexture: {
                        access: 'write-only',
                        format: config.skyRenderer.passConfig.renderTarget.texture.format,
                        viewDimension: config.skyRenderer.passConfig.renderTarget.texture.dimension,
                    },
                },
            ];

            this.renderSkyWithLutsBindGroupLayout = device.createBindGroupLayout({
                label: `Render sky with luts bind group layout [${this.resources.label}]`,
                entries: [
                    ...renderSkyBindGroupLayoutBaseEntries,
                    {
                        binding: 3,
                        visibility: GPUShaderStage.COMPUTE,
                        texture: {
                            sampleType: 'float',
                            viewDimension: this.resources.transmittanceLut.texture.dimension,
                            multisampled: false,
                        },
                    },
                    {
                        binding: 4,
                        visibility: GPUShaderStage.COMPUTE,
                        texture: {
                            sampleType: 'float',
                            viewDimension: this.resources.skyViewLut.texture.dimension,
                            multisampled: false,
                        },
                    },
                    {
                        binding: 5,
                        visibility: GPUShaderStage.COMPUTE,
                        texture: {
                            sampleType: 'float',
                            viewDimension: this.resources.aerialPerspectiveLut.texture.dimension,
                            multisampled: false,
                        },
                    },
                    ...externalResourcesLayoutEntries,
                ].map((v, i) => {
                    v.binding = i;
                    return v;
                }) as GPUBindGroupLayoutEntry[],
            });

            this.renderSkyRaymarchingBindGroupLayout = device.createBindGroupLayout({
                label: `Render sky raymarching bind group layout [${this.resources.label}]`,
                entries: [
                    ...renderSkyBindGroupLayoutBaseEntries,
                    {
                        binding: 3,
                        visibility: GPUShaderStage.COMPUTE,
                        texture: {
                            sampleType: 'float',
                            viewDimension: this.resources.transmittanceLut.texture.dimension,
                            multisampled: false,
                        },
                    },
                    {
                        binding: 4,
                        visibility: GPUShaderStage.COMPUTE,
                        texture: {
                            sampleType: 'float',
                            viewDimension: this.resources.multiScatteringLut.texture.dimension,
                            multisampled: false,
                        },
                    },
                    ...externalResourcesLayoutEntries,
                ].map((v, i) => {
                    v.binding = i;
                    return v;
                }) as GPUBindGroupLayoutEntry[],
            });

            const [withLutsBindGroup, rayMarchingBindGroup] = this.makeBindGroups({
                depthBuffer: config.skyRenderer.depthBuffer.view ?? config.skyRenderer.depthBuffer.texture,
                backBuffer: config.skyRenderer.passConfig.backBuffer.view ?? config.skyRenderer.passConfig.backBuffer.texture,
                renderTarget: config.skyRenderer.passConfig.renderTarget.view ?? config.skyRenderer.passConfig.renderTarget.texture,
            });

            const dispatchDimensions: [number, number, number] = [
                Math.ceil(config.skyRenderer.passConfig.renderTarget.texture.width / 16.0),
                Math.ceil(config.skyRenderer.passConfig.renderTarget.texture.height / 16.0),
                1,
            ];

            this.renderSkyWithLutsPass = new ComputePass(
                device.createComputePipeline({
                    label: `Render sky with LUTs pipeline [${this.resources.label}]`,
                    layout: device.createPipelineLayout({
                        label: `Render sky with LUTs pipeline layout [${this.resources.label}]`,
                        bindGroupLayouts: [
                            this.renderSkyWithLutsBindGroupLayout,
                        ],
                    }),
                    compute: {
                        module: device.createShaderModule({
                            code: makeRenderSkyWithLutsShaderCode(),
                        }),
                        entryPoint: 'render_sky_atmosphere',
                        constants: {
                            SKY_VIEW_LUT_RES_X: this.resources.skyViewLut.texture.width,
                            SKY_VIEW_LUT_RES_Y: this.resources.skyViewLut.texture.height,
                            IS_REVERSE_Z: Number(config.skyRenderer.depthBuffer.reverseZ ?? false),
                            RENDER_SUN_DISK: Number(config.lights?.renderSunDisk ?? true),
                            RENDER_MOON_DISK: Number(config.lights?.renderMoonDisk ?? (config.lights?.useMoon ?? false)),
                            USE_MOON: Number(config.lights?.useMoon ?? false),
                        },
                    },
                }),
                [withLutsBindGroup],
                dispatchDimensions,
            );

            this.renderSkyRaymarchingPass = new ComputePass(
                device.createComputePipeline({
                    label: `Render sky raymarching pipeline [${this.resources.label}]`,
                    layout: device.createPipelineLayout({
                        label: 'Render sky raymarching pipeline layout',
                        bindGroupLayouts: [
                            this.renderSkyRaymarchingBindGroupLayout,
                            ...(config.shadow?.bindGroupLayouts ?? []),
                        ],
                    }),
                    compute: {
                        module: device.createShaderModule({
                            code: `${config.shadow?.wgslCode || 'fn get_shadow(p: vec3<f32>) -> f32 { return 1.0; }'}\n${makeRenderSkyRaymarchingShaderCode()}`,
                        }),
                        entryPoint: 'render_sky_atmosphere',
                        constants: {
                            INV_DISTANCE_TO_MAX_SAMPLE_COUNT: 1.0 / (config.skyRenderer.distanceToMaxSampleCount ?? (100.0 * (config.distanceScaleFactor ?? 1.0))),
                            RANDOMIZE_SAMPLE_OFFSET: Number(config.skyRenderer.randomizeRayOffsets ?? true),
                            MULTI_SCATTERING_LUT_RES_X: this.resources.multiScatteringLut.texture.width,
                            MULTI_SCATTERING_LUT_RES_Y: this.resources.multiScatteringLut.texture.height,
                            IS_REVERSE_Z: Number(config.skyRenderer.depthBuffer.reverseZ ?? false),
                            RENDER_SUN_DISK: Number(config.lights?.renderSunDisk ?? true),
                            RENDER_MOON_DISK: Number(config.lights?.renderMoonDisk ?? (config.lights?.useMoon ?? false)),
                            USE_MOON: Number(config.lights?.useMoon ?? false),
                            USE_COLORED_TRANSMISSION: Number(config.skyRenderer.passConfig.useColoredTransmittanceOnPerPixelRayMarch ?? true),
                        },
                    },
                }),
                [
                    rayMarchingBindGroup,
                    ...(config.shadow?.bindGroups ?? []),
                ],
                dispatchDimensions,
            );
        } else {
            throw Error(`[SkyAtmosphereComputeRenderer]: missing compute pass config`);
        }
    }

    private makeBindGroups(config: SkyAtmosphereComputeRendererResizeConfig): [GPUBindGroup, GPUBindGroup] {
        const renderSkyBindGroupBaseEntries: GPUBindGroupEntry[] = [
            {
                binding: 0,
                resource: {
                    buffer: this.resources.atmosphereBuffer,
                },
            },
            {
                binding: 1,
                resource: {
                    buffer: this.resources.uniformsBuffer,
                },
            },
            {
                binding: 2,
                resource: this.resources.lutSampler,
            },
        ];
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
                        binding: 3,
                        resource: this.resources.transmittanceLut.view,
                    },
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
            this.resources.device.createBindGroup({
                label: `Render sky raymarching bind group [${this.resources.label}]`,
                layout: this.renderSkyRaymarchingBindGroupLayout,
                entries: [
                    ...renderSkyBindGroupBaseEntries,
                    {
                        binding: 3,
                        resource: this.resources.transmittanceLut.view,
                    },
                    {
                        binding: 4,
                        resource: this.resources.multiScatteringLut.view,
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
     * Either initialize these lookup tables in the constructor using {@link SkyAtmosphereConfig.initializeConstantLuts}, or call {@link renderConstantLuts}.
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
    private renderSkyWithLutsBindGroupLayout: GPUBindGroupLayout;
    private renderSkyWithLutsPass: RenderPass;
    private renderSkyRaymarchingBindGroupLayout: GPUBindGroupLayout;
    private renderSkyRaymarchingPass: RenderPass;

    /**
     * Creates a {@link SkyAtmosphereRasterRenderer}.
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereConfig} used to configure internal resources and behavior.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereConfig}. Especially, {@link SkyAtmosphereConfig.lookUpTables} and {@link SkyAtmosphereConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    constructor(device: GPUDevice, config: SkyAtmosphereConfig, existingPipelines?: SkyAtmospherePipelines, existingResources?: SkyAtmosphereResources) {
        super(device, config, existingPipelines, existingResources);
        if (isComputePassConfig(config.skyRenderer.passConfig)) {
            throw Error(`[SkyAtmosphereRenderRenderer]: missing render pass config`);
        } else {
            const useDualSourceBlending = device.features.has('dual-source-blending') && (config.skyRenderer.passConfig.useDualSourceBlending ?? false);
            if (!useDualSourceBlending && config.skyRenderer.passConfig.useDualSourceBlending) {
                console.warn('[SkyAtmosphereRenderer]: dual source blending was requested but the device feature is not enabled');
            }

            const blendState: GPUBlendState = {
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
            };
            const dualBlendState: GPUBlendState = {
                color: {
                    operation: 'add',
                    srcFactor: 'one',
                    dstFactor: 'src1' as GPUBlendFactor, // dual-source-blending is a fairly new feature
                },
                alpha: {
                    operation: 'add',
                    srcFactor: 'zero',
                    dstFactor: 'one',
                },
            };

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
                {
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
                        viewDimension: this.resources.transmittanceLut.texture.dimension,
                        multisampled: false,
                    },
                },
            ];
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

            this.renderSkyWithLutsBindGroupLayout = device.createBindGroupLayout({
                label: `Render sky with luts bind group layout [${this.resources.label}]`,
                entries: [
                    ...renderSkyBindGroupLayoutBaseEntries,
                    {
                        binding: 4,
                        visibility: GPUShaderStage.FRAGMENT,
                        texture: {
                            sampleType: 'float',
                            viewDimension: this.resources.skyViewLut.texture.dimension,
                            multisampled: false,
                        },
                    },
                    {
                        binding: 5,
                        visibility: GPUShaderStage.FRAGMENT,
                        texture: {
                            sampleType: 'float',
                            viewDimension: this.resources.aerialPerspectiveLut.texture.dimension,
                            multisampled: false,
                        },
                    },
                    ...externalResourcesLayoutEntries,
                ],
            });
            this.renderSkyRaymarchingBindGroupLayout = device.createBindGroupLayout({
                label: `Render sky raymarching bind group layout [${this.resources.label}]`,
                entries: [
                    ...renderSkyBindGroupLayoutBaseEntries,
                    {
                        binding: 4,
                        visibility: GPUShaderStage.FRAGMENT,
                        texture: {
                            sampleType: 'float',
                            viewDimension: this.resources.multiScatteringLut.texture.dimension,
                            multisampled: false,
                        },
                    },
                    ...externalResourcesLayoutEntries,
                ].map((v, i) => {
                    v.binding = i;
                    return v;
                }) as GPUBindGroupLayoutEntry[],
            });

            const [withLutsBindGroup, rayMarchingBindGroup] = this.makeBindGroups(
                config.skyRenderer.depthBuffer.view ?? config.skyRenderer.depthBuffer.texture,
            );

            // render sky with luts pass
            {
                const writeTransmissionOnlyOnPerPixelRayMarch = config.skyRenderer.passConfig.writeTransmissionOnlyOnPerPixelRayMarch ?? true;
                const targets: GPUColorTargetState[] = [
                    {
                        format: config.skyRenderer.passConfig.renderTargetFormat,
                        blend: useDualSourceBlending && !writeTransmissionOnlyOnPerPixelRayMarch ? dualBlendState : blendState,
                        writeMask: GPUColorWrite.ALL,
                    },
                ];
                if (config.skyRenderer.passConfig.transmissionFormat && !writeTransmissionOnlyOnPerPixelRayMarch) {
                    targets.push({ format: config.skyRenderer.passConfig.transmissionFormat, });
                }

                let code = makeRenderSkyWithLutsShaderCode();
                if (useDualSourceBlending) {
                    code = code.replace('@location(0)', '@location(0) @blend_src(0)');
                    code = code.replace('@location(1)', '@location(1) @blend_src(1)');
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

                this.renderSkyWithLutsPass = new RenderPass(
                    device.createRenderPipeline({
                        label: `Render sky with LUTs pipeline [${this.resources.label}]`,
                        layout: device.createPipelineLayout({
                            label: 'Render sky with LUTs pipeline layout',
                            bindGroupLayouts: [
                                this.renderSkyWithLutsBindGroupLayout,
                            ],
                        }),
                        vertex: {
                            module,
                        },
                        fragment: {
                            module,
                            constants: {
                                SKY_VIEW_LUT_RES_X: this.resources.skyViewLut.texture.width,
                                SKY_VIEW_LUT_RES_Y: this.resources.skyViewLut.texture.height,
                                IS_REVERSE_Z: Number(config.skyRenderer.depthBuffer.reverseZ ?? false),
                                RENDER_SUN_DISK: Number(config.lights?.renderSunDisk ?? true),
                                RENDER_MOON_DISK: Number(config.lights?.renderMoonDisk ?? (config.lights?.useMoon ?? false)),
                                USE_MOON: Number(config.lights?.useMoon ?? false),
                            },
                            targets,
                        },
                    }),
                    [withLutsBindGroup],
                );
            }

            // render sky raymarching
            {
                const targets: GPUColorTargetState[] = [
                    {
                        format: config.skyRenderer.passConfig.renderTargetFormat,
                        blend: useDualSourceBlending ? dualBlendState : blendState,
                        writeMask: GPUColorWrite.ALL,
                    },
                ];
                if (config.skyRenderer.passConfig.transmissionFormat) {
                    targets.push({ format: config.skyRenderer.passConfig.transmissionFormat, });
                }

                let code = makeRenderSkyRaymarchingShaderCode();
                if (useDualSourceBlending) {
                    code = code.replace('@location(0)', '@location(0) @blend_src(0)');
                    code = code.replace('@location(1)', '@location(1) @blend_src(1)');
                } else if (targets.length !== 2) {
                    code = code.replace('@location(1) transmittance: vec4<f32>,', '');
                    code = code.replace(
                        'RenderSkyFragment(result.luminance, result.transmittance)',
                        'RenderSkyFragment(vec4(result.luminance.rgb, 1.0 - dot(result.transmittance.rgb, vec3(1.0 / 3.0))))',
                    );
                }
                const module = device.createShaderModule({
                    label: 'Render sky raymarching',
                    code: `${config.shadow?.wgslCode || 'fn get_shadow(p: vec3<f32>) -> f32 { return 1.0; }'}\n${code}`,
                });

                this.renderSkyRaymarchingPass = new RenderPass(
                    device.createRenderPipeline({
                        label: `Render sky raymarching pipeline [${this.resources.label}]`,
                        layout: device.createPipelineLayout({
                            label: `Render sky raymarching pipeline layout [${this.resources.label}]`,
                            bindGroupLayouts: [
                                this.renderSkyRaymarchingBindGroupLayout,
                                ...(config.shadow?.bindGroupLayouts || []),
                            ],
                        }),
                        vertex: {
                            module,
                        },
                        fragment: {
                            module,
                            constants: {
                                INV_DISTANCE_TO_MAX_SAMPLE_COUNT: 1.0 / (config.skyRenderer.distanceToMaxSampleCount ?? (100.0 * (config.distanceScaleFactor ?? 1.0))),
                                RANDOMIZE_SAMPLE_OFFSET: Number(config.skyRenderer.randomizeRayOffsets ?? true),
                                MULTI_SCATTERING_LUT_RES_X: this.resources.multiScatteringLut.texture.width,
                                MULTI_SCATTERING_LUT_RES_Y: this.resources.multiScatteringLut.texture.height,
                                IS_REVERSE_Z: Number(config.skyRenderer.depthBuffer.reverseZ ?? false),
                                RENDER_SUN_DISK: Number(config.lights?.renderSunDisk ?? true),
                                RENDER_MOON_DISK: Number(config.lights?.renderMoonDisk ?? (config.lights?.useMoon ?? false)),
                                USE_MOON: Number(config.lights?.useMoon ?? false),
                            },
                            targets,
                        },
                    }),
                    [
                        rayMarchingBindGroup,
                        ...(config.shadow?.bindGroups ?? []),
                    ],
                );
            }
        }

    }

    private makeBindGroups(depthBuffer: GPUTextureView | GPUTexture,): [GPUBindGroup, GPUBindGroup] {
        const renderSkyBindGroupBaseEntries: GPUBindGroupEntry[] = [
            {
                binding: 0,
                resource: {
                    buffer: this.resources.atmosphereBuffer,
                },
            },
            {
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
        ];
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
                ],
            }),
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
            }),
        ];
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
        this.renderSkyWithLutsPass.encode(passEncoder);
    }

    /**
     * Renders the sky / atmosphere using full-screen ray marching.
     *
     * Requires the transmittance and multiple scattering lookup tables to be initialized.
     * Either initialize these lookup tables in the constructor using {@link SkyAtmosphereConfig.initializeConstantLuts}, or call {@link renderConstantLuts}.
     *
     * @param passEncoder A `GPURenderPassEncoder` or `GPURenderBundleEncoder` to encode the pass with. The encoder is not `end()`ed by this function.
     *
     * @see {@link renderConstantLuts}: To initialize the lookup tables required, call this function.
     */
    public renderSkyRaymarching(passEncoder: GPURenderPassEncoder | GPURenderBundleEncoder) {
        this.renderSkyRaymarchingPass.encode(passEncoder);
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
}

