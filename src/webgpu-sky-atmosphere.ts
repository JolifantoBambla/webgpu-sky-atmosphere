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
    configToFloatArray,
    CONFIG_BUFFER_SIZE,
    SkyAtmosphereResources,
} from './resources.js';

import {
    makeRenderSkyWithLutsShaderCode,
    makeRenderSkyRaymarchingShaderCode,
} from './shaders.js';
import { SkyAtmospherePipelines } from './pipelines.js';
import { ComputePass, RenderPass } from './util.js';

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
    configToFloatArray,
    CONFIG_BUFFER_SIZE,
    SkyAtmosphereResources,
};

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

    private renderSkyWithLutsPass: ComputePass | RenderPass;
    private renderSkyRaymarchingPass: ComputePass | RenderPass;

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
                    minBindingSize: CONFIG_BUFFER_SIZE,
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
                    buffer: this.resources.configBuffer,
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

        if (config.initializeConstantLuts ?? true) {
            const commandEncoder = device.createCommandEncoder();
            const computePassEncoder = commandEncoder.beginComputePass();
            this.transmittanceLutPass.encode(computePassEncoder);
            this.multiScatteringLutPass.encode(computePassEncoder);
            computePassEncoder.end();
            device.queue.submit([commandEncoder.finish()]);
        }
    }

    public updateAtmosphere(atmosphere: Atmosphere) {
        this.resources.updateAtmosphere(atmosphere);
    }

    public updateConfig(config: Uniforms) {
        this.resources.updateConfig(config);
    }

    public renderTransmittanceLut(computePassEncoder: GPUComputePassEncoder) {
        this.transmittanceLutPass.encode(computePassEncoder);
    }

    public renderMultiScatteringLut(computePassEncoder: GPUComputePassEncoder) {
        this.multiScatteringLutPass.encode(computePassEncoder);
    }

    public renderSkyViewLut(computePassEncoder: GPUComputePassEncoder) {
        this.skyViewLutPass.encode(computePassEncoder);
    }

    public renderAerialPerspectiveLut(computePassEncoder: GPUComputePassEncoder) {
        this.aerialPerspectiveLutPass.encode(computePassEncoder);
    }

    public renderSkyWithLuts(computePassEncoder: GPUComputePassEncoder) {
        if (this.renderSkyWithLutsPass instanceof ComputePass) {
            this.renderSkyWithLutsPass.encode(computePassEncoder);
        }
    }

    public renderSkyRaymarching(computePassEncoder: GPUComputePassEncoder) {
        if (this.renderSkyRaymarchingPass instanceof ComputePass) {
            this.renderSkyRaymarchingPass.encode(computePassEncoder);
        }
    }

    public renderSkyAtmosphere(computePassEncoder: GPUComputePassEncoder, isCameraInSpace: boolean, useColoredTransmittance: boolean, config?: Uniforms, atmosphere?: Atmosphere) {
        if (atmosphere) {
            this.updateAtmosphere(atmosphere);

            this.renderTransmittanceLut(computePassEncoder);
            this.renderMultiScatteringLut(computePassEncoder);
        }

        if (config) {
            this.updateConfig(config);
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
