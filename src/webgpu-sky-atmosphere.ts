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
}

function isComputePassConfig(passConfig: SkyRendererComputePassConfig | SkyRenderPassConfig): passConfig is SkyRendererComputePassConfig {
    return (passConfig as SkyRendererComputePassConfig).backBuffer !== undefined;
}

export class SkyAtmosphereRenderer {
    readonly resources: SkyAtmosphereResources;

    readonly skyAtmospherePipelines: SkyAtmospherePipelines;

    readonly defaultToPerPixelRayMarch: boolean;

    private transmittanceLutPass: ComputePass;
    private multiScatteringLutPass: ComputePass;
    private skyViewLutPass: ComputePass;
    private aerialPerspectiveLutPass: ComputePass;

    /**
     * Creates a {@link SkyAtmosphereRenderer}.
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereConfig} used to configure internal resources and behavior.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereConfig}. Especially, {@link SkyAtmosphereConfig.lookUpTables} and {@link SkyAtmosphereConfig.shadow} should be the same.
     */
    constructor(device: GPUDevice, config: SkyAtmosphereConfig, existingPipelines?: SkyAtmospherePipelines) {
        if ((existingPipelines?.transmittanceLutPipeline.device || device) !== device) {
            this.skyAtmospherePipelines = new SkyAtmospherePipelines(device, config);
        } else {
            this.skyAtmospherePipelines = existingPipelines || new SkyAtmospherePipelines(device, config);
        }

        this.defaultToPerPixelRayMarch = config.skyRenderer.defaultToPerPixelRayMarch ?? false;

        this.resources = new SkyAtmosphereResources(device, config, this.skyAtmospherePipelines.lutSampler);

        this.transmittanceLutPass = this.skyAtmospherePipelines.transmittanceLutPipeline.makeComputePass(this.resources);
        this.multiScatteringLutPass = this.skyAtmospherePipelines.multiScatteringLutPipeline.makeComputePass(this.resources);
        this.skyViewLutPass = this.skyAtmospherePipelines.skyViewLutPipeline.makeComputePass(this.resources);
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
     * Creates a new instance of a {@link SkyAtmosphereComputeRenderer} or a {@link SkyAtmosphereRenderRenderer}, depending on the {@link SkyRendererPassConfig} given as part of the {@link SkyAtmosphereConfig}.
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereConfig} used to configure internal resources and behavior. Determines if a {@link SkyAtmosphereComputeRenderer} or a {@link SkyAtmosphereRenderRenderer} is returned.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereConfig}. Especially, {@link SkyAtmosphereConfig.lookUpTables} and {@link SkyAtmosphereConfig.shadow} should be the same.
     * @returns Returns a {@link SkyAtmosphereComputeRenderer} or a {@link SkyAtmosphereRenderRenderer}, depending on the {@link SkyRendererPassConfig} given as part of the {@link SkyAtmosphereConfig}.
     */
    public static makeSkyAtmosphereRenderer(device: GPUDevice, config: SkyAtmosphereConfig, existingPipelines?: SkyAtmospherePipelines): SkyAtmosphereComputeRenderer | SkyAtmosphereRenderRenderer {
        if (isComputePassConfig(config.skyRenderer.passConfig)) {
            return new SkyAtmosphereComputeRenderer(device, config, existingPipelines);
        } else {
            return new SkyAtmosphereRenderRenderer(device, config, existingPipelines);
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
     * @param passEncoder Used to encode rendering of the lookup table. The encoder is not `end`ed by this function.
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
     * @param passEncoder Used to encode rendering of the lookup table. The encoder is not `end`ed by this function.
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
     * @param passEncoder Used to encode rendering of the lookup tables. The encoder is not `end`ed by this function.
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
     * @param passEncoder Used to encode rendering of the lookup table. The encoder is not `end`ed by this function.
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
     * @param passEncoder Used to encode rendering of the lookup table. The encoder is not `end`ed by this function.
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
     * @param passEncoder Used to encode rendering of the lookup tables. The encoder is not `end`ed by this function.
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
}

export class SkyAtmosphereComputeRenderer extends SkyAtmosphereRenderer {
    private renderSkyWithLutsPass: ComputePass;
    private renderSkyRaymarchingPass: ComputePass;

    constructor(device: GPUDevice, config: SkyAtmosphereConfig, existingPipelines?: SkyAtmospherePipelines) {
        super(device, config, existingPipelines);
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
        if (isComputePassConfig(config.skyRenderer.passConfig)) {
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

            const externalResourcesBindGroupEntries = [
                {
                    binding: 5,
                    resource: config.skyRenderer.depthBuffer.view ?? config.skyRenderer.depthBuffer.texture.createView(config.skyRenderer.depthBuffer.texture.format.includes('depth') ? {
                        aspect: 'depth-only',
                    } : {}),
                },
                {
                    binding: 6,
                    resource: config.skyRenderer.passConfig.backBuffer.view ?? config.skyRenderer.passConfig.backBuffer.texture.createView(),
                },
                {
                    binding: 7,
                    resource: config.skyRenderer.passConfig.renderTarget.view ?? config.skyRenderer.passConfig.renderTarget.texture.createView(),
                },
            ];

            // render sky with luts pass - compute
            {
                const renderSkyWithLutsBindGroupLayout = device.createBindGroupLayout({
                    label: 'Render sky with luts bind group layout',
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


                const renderSkyWithLutsBindGroup = device.createBindGroup({
                    label: 'Render sky with LUTs bind group',
                    layout: renderSkyWithLutsBindGroupLayout,
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
                });

                const renderSkyPipeline = device.createComputePipeline({
                    label: 'Render sky with LUTs pipeline',
                    layout: device.createPipelineLayout({
                        label: 'Render sky with LUTs pipeline layout',
                        bindGroupLayouts: [
                            renderSkyWithLutsBindGroupLayout,
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
                });

                this.renderSkyWithLutsPass = new ComputePass(
                    renderSkyPipeline,
                    [renderSkyWithLutsBindGroup],
                    [
                        Math.ceil(config.skyRenderer.passConfig.renderTarget.texture.width / 16.0),
                        Math.ceil(config.skyRenderer.passConfig.renderTarget.texture.height / 16.0),
                        1,
                    ],
                );
            }

            // render sky raymarching - compute
            {
                const renderSkyRaymarchingBindGroupLayout = device.createBindGroupLayout({
                    label: 'Render sky raymarching bind group layout',
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

                const renderSkyRaymarchingBindGroup = device.createBindGroup({
                    label: 'Render sky raymarching bind group',
                    layout: renderSkyRaymarchingBindGroupLayout,
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
                });

                const renderSkyPipeline = device.createComputePipeline({
                    label: 'Render sky raymarching pipeline',
                    layout: device.createPipelineLayout({
                        label: 'Render sky raymarching pipeline layout',
                        bindGroupLayouts: [
                            renderSkyRaymarchingBindGroupLayout,
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
                });

                this.renderSkyRaymarchingPass = new ComputePass(
                    renderSkyPipeline,
                    [
                        renderSkyRaymarchingBindGroup,
                        ...(config.shadow?.bindGroups ?? []),
                    ],
                    [
                        Math.ceil(config.skyRenderer.passConfig.renderTarget.texture.width / 16.0),
                        Math.ceil(config.skyRenderer.passConfig.renderTarget.texture.height / 16.0),
                        1,
                    ],
                );
            }
        } else {
            throw Error(`[SkyAtmosphereComputeRenderer]: missing compute pass config`);
        }
    }

    /**
     * Renders the sky and aerial perspective using precomputed lookup tables.
     * 
     * Requires the sky view and aerial perspective lookup tables to be initialized.
     * To initialize these lookup tables, call {@link renderDynamicLuts}.
     * 
     * @param passEncoder A `GPUComputePassEncoder` to encode the pass with. Can be the same encoder used to initialize the sky view and aerial perspective lookup tables.
     * 
     * @see renderDynamicLuts
     */
    public renderSkyWithLuts(passEncoder: GPUComputePassEncoder) {
        this.renderSkyWithLutsPass.encode(passEncoder);
    }

    /**
     * Renders the sky and aerial perspective using per-pixel ray marching.
     * 
     * Requires the transmittance and multiple scattering lookup tables to be initialized.
     * Either initialize these lookup tables in the constructor using {@link SkyAtmosphereConfig.initializeConstantLuts}, or call {@link renderConstantLuts}.
     * 
     * @param passEncoder A `GPUComputePassEncoder` to encode the pass with. Can be the same encoder used to initialize the transmittance and multiple scattering lookup tables.
     * 
     * @see renderConstantLuts
     */
    public renderSkyRaymarching(passEncoder: GPUComputePassEncoder) {
        this.renderSkyRaymarchingPass.encode(passEncoder);
    }

    public renderSkyAtmosphere(computePassEncoder: GPUComputePassEncoder, isCameraInSpace: boolean, useColoredTransmittance: boolean, config?: Uniforms, atmosphere?: Atmosphere) {
        if (atmosphere) {
            this.renderConstantLuts(computePassEncoder, atmosphere);
        }

        if (config) {
            this.updateUniforms(config);
        }

        if (isCameraInSpace || this.defaultToPerPixelRayMarch) {
            this.renderSkyRaymarching(computePassEncoder);
        } else {
            this.renderSkyViewLut(computePassEncoder);

            if (useColoredTransmittance) {
                // render using sky view lut & ray marching
                // todo: sky view + ray marching
                this.renderSkyRaymarching(computePassEncoder);
            } else {
                this.renderAerialPerspectiveLut(computePassEncoder);

                this.renderSkyWithLuts(computePassEncoder);
            }
        }
    }
}

export class SkyAtmosphereRenderRenderer extends SkyAtmosphereRenderer {
    private renderSkyWithLutsPass: RenderPass;
    private renderSkyRaymarchingPass: RenderPass;

    constructor(device: GPUDevice, config: SkyAtmosphereConfig, existingPipelines?: SkyAtmospherePipelines) {
        super(device, config, existingPipelines);
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

            const externalResourcesLayoutEntries: GPUBindGroupLayoutEntry[] = [
                {
                    binding: 5,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {
                        sampleType: 'unfilterable-float',
                        viewDimension: config.skyRenderer.depthBuffer.texture.dimension,
                        multisampled: false,
                    },
                },
            ];

            const externalResourcesBindGroupEntries: GPUBindGroupEntry[] = [
                {
                    binding: 5,
                    resource: config.skyRenderer.depthBuffer.view ?? config.skyRenderer.depthBuffer.texture.createView(config.skyRenderer.depthBuffer.texture.format.includes('depth') ? {
                        aspect: 'depth-only',
                    } : {}),
                },
            ];

            // render sky with luts pass - render
            {
                const renderSkyWithLutsBindGroupLayout = device.createBindGroupLayout({
                    label: 'Render sky with luts bind group layout',
                    entries: [
                        ...renderSkyBindGroupLayoutBaseEntries,
                        {
                            binding: 3,
                            visibility: GPUShaderStage.FRAGMENT,
                            texture: {
                                sampleType: 'float',
                                viewDimension: this.resources.skyViewLut.texture.dimension,
                                multisampled: false,
                            },
                        },
                        {
                            binding: 4,
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


                const renderSkyWithLutsBindGroup = device.createBindGroup({
                    label: 'Render sky with LUTs bind group',
                    layout: renderSkyWithLutsBindGroupLayout,
                    entries: [
                        ...renderSkyBindGroupBaseEntries,
                        {
                            binding: 3,
                            resource: this.resources.skyViewLut.view,
                        },
                        {
                            binding: 4,
                            resource: this.resources.aerialPerspectiveLut.view,
                        },
                        ...externalResourcesBindGroupEntries,
                    ],
                });

                const module = device.createShaderModule({
                    code: makeRenderSkyWithLutsShaderCode(),
                });

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

                const renderSkyPipeline = device.createRenderPipeline({
                    label: 'Render sky with LUTs pipeline',
                    layout: device.createPipelineLayout({
                        label: 'Render sky with LUTs pipeline layout',
                        bindGroupLayouts: [
                            renderSkyWithLutsBindGroupLayout,
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
                });

                this.renderSkyWithLutsPass = new RenderPass(
                    renderSkyPipeline,
                    [renderSkyWithLutsBindGroup],
                );
            }

            // render sky raymarching - render
            {
                const renderSkyRaymarchingBindGroupLayout = device.createBindGroupLayout({
                    label: 'Render sky raymarching bind group layout',
                    entries: [
                        ...renderSkyBindGroupLayoutBaseEntries,
                        {
                            binding: 3,
                            visibility: GPUShaderStage.FRAGMENT,
                            texture: {
                                sampleType: 'float',
                                viewDimension: this.resources.transmittanceLut.texture.dimension,
                                multisampled: false,
                            },
                        },
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
                    ],
                });

                const renderSkyRaymarchingBindGroup = device.createBindGroup({
                    label: 'Render sky raymarching bind group',
                    layout: renderSkyRaymarchingBindGroupLayout,
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
                    ],
                });

                const module = device.createShaderModule({
                    code: `${config.shadow?.wgslCode || 'fn get_shadow(p: vec3<f32>) -> f32 { return 1.0; }'}\n${makeRenderSkyRaymarchingShaderCode()}`,
                });

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

                const renderSkyPipeline = device.createRenderPipeline({
                    label: 'Render sky raymarching pipeline',
                    layout: device.createPipelineLayout({
                        label: 'Render sky raymarching pipeline layout',
                        bindGroupLayouts: [
                            renderSkyRaymarchingBindGroupLayout,
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
                });

                this.renderSkyRaymarchingPass = new RenderPass(
                    renderSkyPipeline,
                    [
                        renderSkyRaymarchingBindGroup,
                        ...(config.shadow?.bindGroups ?? []),
                    ],
                );
            }
        }

    }

    public renderSkyWithLuts(passEncoder: GPURenderPassEncoder | GPURenderBundleEncoder) {
        this.renderSkyWithLutsPass.encode(passEncoder);
    }

    public renderSkyRaymarching(passEncoder: GPURenderPassEncoder | GPURenderBundleEncoder) {
        this.renderSkyRaymarchingPass.encode(passEncoder);
    }

    public renderSkyAtmosphere(computePassEncoder: GPUComputePassEncoder, isCameraInSpace: boolean, useColoredTransmittance: boolean, config?: Uniforms, atmosphere?: Atmosphere) {
        if (atmosphere) {
            this.updateAtmosphere(atmosphere);

            this.renderTransmittanceLut(computePassEncoder);
            this.renderMultiScatteringLut(computePassEncoder);
        }

        if (config) {
            this.updateUniforms(config);
        }

        if (isCameraInSpace || this.defaultToPerPixelRayMarch) {
            //this.renderSkyRaymarching(computePassEncoder);
        } else {
            this.renderSkyViewLut(computePassEncoder);

            if (useColoredTransmittance) {
                // render using sky view lut & ray marching
                // todo: sky view + ray marching
                //this.renderSkyRaymarching(computePassEncoder);
            } else {
                this.renderAerialPerspectiveLut(computePassEncoder);

                //this.renderSkyWithLuts(computePassEncoder);
            }
        }
    }
}

