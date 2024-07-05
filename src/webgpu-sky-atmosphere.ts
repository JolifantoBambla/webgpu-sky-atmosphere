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
    ComputeBackBufferConfig,
    ComputeRenderTargetConfig,
    CoordinateSystemConfig,
    DepthBufferConfig,
    SkyAtmosphereLutConfig,
    SkyAtmosphereConfig,
    SkyRendererComputePassConfig,
    SkyRendererPassConfig,
    SkyRenderPassConfig,
    SkyRendererShadowConfig,
} from './config.js';

import { Camera, Sun, Uniforms } from './uniforms.js';
import { ATMOSPHERE_BUFFER_SIZE, CONFIG_BUFFER_SIZE, SkyAtmosphereResources } from './resources.js';

import {
    makeRenderSkyWithLutsShaderCode,
    makeRenderSkyRaymarchingShaderCode,
} from './shaders.js';
import { SkyAtmospherePipelines } from './pipelines.js';
import { ComputePass } from './util.js';

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
    ComputeBackBufferConfig,
    ComputeRenderTargetConfig,
    CoordinateSystemConfig,
    DepthBufferConfig,
    SkyAtmosphereLutConfig,
    SkyAtmosphereConfig,
    SkyRendererComputePassConfig,
    SkyRendererPassConfig,
    SkyRenderPassConfig,
    SkyRendererShadowConfig,
};

export {
    Camera,
    Sun,
    Uniforms,
};

function isComputePassConfig(passConfig: SkyRendererComputePassConfig | SkyRenderPassConfig): passConfig is SkyRendererComputePassConfig {
    return (passConfig as SkyRendererComputePassConfig).backBuffer !== undefined;
}

export class SkyAtmosphereRenderer {
    readonly resources: SkyAtmosphereResources;

    readonly skyAtmospherePipelines: SkyAtmospherePipelines;

    private transmittanceLutPass: ComputePass;
    private multiScatteringLutPass: ComputePass;
    private skyViewLutPass: ComputePass;
    private aerialPerspectiveLutPass: ComputePass;

    private renderSkyWithLutsPass?: ComputePass;
    private renderSkyRaymarchingPass?: ComputePass;

    constructor(device: GPUDevice, config: SkyAtmosphereConfig, existingPipelines?: SkyAtmospherePipelines) {
        if ((existingPipelines?.transmittanceLutPipeline.device || device) !== device) {
            this.skyAtmospherePipelines = new SkyAtmospherePipelines(device, config);
        } else {
            this.skyAtmospherePipelines = existingPipelines || new SkyAtmospherePipelines(device, config);
        }

        this.resources = new SkyAtmosphereResources(device, config, this.skyAtmospherePipelines.lutSampler);

        this.transmittanceLutPass = this.skyAtmospherePipelines.transmittanceLutPipeline.makeComputePass(this.resources);
        this.multiScatteringLutPass = this.skyAtmospherePipelines.multiScatteringLutPipeline.makeComputePass(this.resources);
        this.skyViewLutPass = this.skyAtmospherePipelines.skyViewLutPipeline.makeComputePass(this.resources);
        this.aerialPerspectiveLutPass = this.skyAtmospherePipelines.aerialPerspectiveLutPipeline.makeComputePass(this.resources, config.shadow?.bindGroup);

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
        ]

        if (isComputePassConfig(config.skyRenderer.passConfig)) {
            const externalResourcesBindGroupLayout = device.createBindGroupLayout({
                label: 'Render sky raymarching external bind group layout',
                entries: [
                    {
                        binding: 0,
                        visibility: GPUShaderStage.COMPUTE,
                        texture: {
                            sampleType: 'unfilterable-float',
                            viewDimension: config.skyRenderer.depthBuffer.texture.dimension,
                            multisampled: false,
                        },
                    },
                    {
                        binding: 1,
                        visibility: GPUShaderStage.COMPUTE,
                        texture: {
                            sampleType: 'unfilterable-float',
                            viewDimension: config.skyRenderer.passConfig.backBuffer.texture.dimension,
                            multisampled: false,
                        },
                    },
                    {
                        binding: 2,
                        visibility: GPUShaderStage.COMPUTE,
                        storageTexture: {
                            access: 'write-only',
                            format: config.skyRenderer.passConfig.renderTarget.texture.format,
                            viewDimension: config.skyRenderer.passConfig.renderTarget.texture.dimension,
                        },
                    },
                ],
            });

            const externalResourcesBindGroup = device.createBindGroup({
                label: 'External resources bind group',
                layout: externalResourcesBindGroupLayout,
                entries: [
                    {
                        binding: 0,
                        resource: config.skyRenderer.depthBuffer.view!,
                    },
                    {
                        binding: 1,
                        resource: config.skyRenderer.passConfig.backBuffer.view!,
                    },
                    {
                        binding: 2,
                        resource: config.skyRenderer.passConfig.renderTarget.view!,
                    },
                ],
            });

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
                                viewDimension: this.resources.skyViewLut.texture.dimension,
                                multisampled: false,
                            },
                        },
                        {
                            binding: 4,
                            visibility: GPUShaderStage.COMPUTE,
                            texture: {
                                sampleType: 'float',
                                viewDimension: this.resources.aerialPerspectiveLut.texture.dimension,
                                multisampled: false,
                            },
                        },
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
                    ],
                });

                const renderSkyPipeline = device.createComputePipeline({
                    label: 'Render sky with LUTs pipeline',
                    layout: device.createPipelineLayout({
                        label: 'Render sky with LUTs pipeline layout',
                        bindGroupLayouts: [
                            renderSkyWithLutsBindGroupLayout,
                            externalResourcesBindGroupLayout,
                        ],
                    }),
                    compute: {
                        module: device.createShaderModule({
                            code: makeRenderSkyWithLutsShaderCode(),
                        }),
                        entryPoint: 'render_sky_atmosphere',
                        constants: {
                            IS_Y_UP: Number(config.coordinateSystem?.yUp ?? true),
                            IS_REVERSE_Z: Number(config.skyRenderer.depthBuffer.reverseZ ?? false),
                        },
                    },
                });

                this.renderSkyWithLutsPass = new ComputePass(
                    renderSkyPipeline,
                    [renderSkyWithLutsBindGroup, externalResourcesBindGroup],
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
                    ],
                });

                const renderSkyPipeline = device.createComputePipeline({
                    label: 'Render sky raymarching pipeline',
                    layout: device.createPipelineLayout({
                        label: 'Render sky raymarching pipeline layout',
                        bindGroupLayouts: [
                            renderSkyRaymarchingBindGroupLayout,
                            externalResourcesBindGroupLayout,
                            config.shadow?.bindGroupLayout,
                        ].filter(layout => layout !== undefined) as GPUBindGroupLayout[],
                    }),
                    compute: {
                        module: device.createShaderModule({
                            code: `${config.shadow?.wgslCode || 'fn get_shadow(p: vec3<f32>) -> f32 { return 1.0; }'}\n${makeRenderSkyRaymarchingShaderCode()}`,
                        }),
                        entryPoint: 'render_sky_atmosphere',
                        constants: {
                            MULTI_SCATTERING_LUT_RES: this.resources.multiScatteringLut.texture.width,
                            IS_Y_UP: Number(config.coordinateSystem?.yUp ?? true),
                            IS_REVERSE_Z: Number(config.skyRenderer.depthBuffer.reverseZ ?? false),
                        },
                    },
                });

                this.renderSkyRaymarchingPass = new ComputePass(
                    renderSkyPipeline,
                    [
                        renderSkyRaymarchingBindGroup,
                        externalResourcesBindGroup,
                        config.shadow?.bindGroup,
                    ].filter(bindGroup => bindGroup !== undefined) as GPUBindGroup[],
                    [
                        Math.ceil(config.skyRenderer.passConfig.renderTarget.texture.width / 16.0),
                        Math.ceil(config.skyRenderer.passConfig.renderTarget.texture.height / 16.0),
                        1,
                    ],
                );
            }
        } else {

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

    public renderAerialPerspective(computePassEncoder: GPUComputePassEncoder) {
        this.aerialPerspectiveLutPass.encode(computePassEncoder);
    }

    public renderSkyWithLuts(computePassEncoder: GPUComputePassEncoder) {
        this.renderSkyWithLutsPass?.encode(computePassEncoder);
    }

    public renderSkyRaymarching(computePassEncoder: GPUComputePassEncoder) {
        this.renderSkyRaymarchingPass?.encode(computePassEncoder);
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

        // todo: only update these luts if camera is within atmosphere
        if (isCameraInSpace) {
            this.renderSkyRaymarching(computePassEncoder);
        } else {
            this.renderSkyViewLut(computePassEncoder);

            if (useColoredTransmittance) {
                // render using sky view lut & ray marching
                // todo: sky view + ray marching
                this.renderSkyRaymarching(computePassEncoder);
            } else {
                this.renderAerialPerspective(computePassEncoder);

                this.renderSkyWithLuts(computePassEncoder);
            }
        }
    }
}
