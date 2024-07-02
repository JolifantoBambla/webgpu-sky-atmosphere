import { Atmosphere, makeEarthAtmosphere } from './atmosphere.js';
import { Camera, Config, makeDefaultConfig } from './config.js';
import { ATMOSPHERE_BUFFER_SIZE, CONFIG_BUFFER_SIZE, SkyAtmosphereLutConfig, SkyAtmosphereResources } from './resources.js';

export {
    Atmosphere,
    makeEarthAtmosphere,
    Camera,
    Config,
    makeDefaultConfig,
};

import {
    makeRenderSkyWithLutsShaderCode,
    makeRenderSkyRaymarchingShaderCode,
} from './shaders.js';
import { SkyAtmospherePipelines } from './pipelines.js';
import { ComputePass } from './util.js';

export interface SkyAtmosphereConfig {
    /**
     * Defaults to 'atmosphere'
     */
    label?: string,
    /**
     * Defaults to true
     */
    initializeConstantLutsAtCreation?: boolean,
    useYup?: boolean,
    useRightHanded?: boolean,
    useReverseZ?: boolean,
    compute?: {
        backBuffer: {
            texture: GPUTexture,
            // created if not supplied
            view?: GPUTextureView,
        },
        depthBuffer: {
            texture: GPUTexture,
            // created if not supplied
            // must be a depth only view
            view?: GPUTextureView,
        },
        renderTarget: {
            texture: GPUTexture,
            // created if not supplied
            view?: GPUTextureView,
        },
    },
    render?: {
        renderTargetFormat: GPUTextureFormat,
        depthBuffer: {
            texture: GPUTexture,
            // created if not supplied
            // must be a depth only view
            view?: GPUTextureView,
        },
    },
    shadow?: {
        bindGroupLayout: GPUBindGroupLayout,
        bindGroup: GPUBindGroup,
        /**
         * Needs to provide a function
         * fn get_shadow(world_space_pos: vec3<f32>) -> f32
         * returns 1.0 for no shadow, 0.0 <= x < 1.0 for shadow
         */
        wgslCode: string,
    }
    lookUpTables?: SkyAtmosphereLutConfig,
}

export class SkyAtmosphereRenderer {
    readonly resources: SkyAtmosphereResources;

    readonly skyAtmospherePipelines: SkyAtmospherePipelines;

    private transmittanceLutPass: ComputePass;
    private multiScatteringLutPass: ComputePass;
    private skyViewLutPass: ComputePass;
    private aerialPerspectiveLutPass: ComputePass;

    private renderSkyWithLutsPass: ComputePass;
    private renderSkyRaymarchingPass: ComputePass;

    constructor(device: GPUDevice, config: SkyAtmosphereConfig = {}, atmosphere: Atmosphere = makeEarthAtmosphere(), existingPipelines?: SkyAtmospherePipelines) {
        if ((existingPipelines?.transmittanceLutPipeline.device || device) !== device) {
            this.skyAtmospherePipelines = new SkyAtmospherePipelines(device);
        } else {
            this.skyAtmospherePipelines = existingPipelines || new SkyAtmospherePipelines(device);
        }

        this.resources = new SkyAtmosphereResources(
            config.label || 'atmosphere',
            device,
            atmosphere,
            config.lookUpTables,
            this.skyAtmospherePipelines.lutSampler,
        );

        this.transmittanceLutPass = this.skyAtmospherePipelines.transmittanceLutPipeline.makeComputePass(this.resources);
        this.multiScatteringLutPass = this.skyAtmospherePipelines.multiScatteringLutPipeline.makeComputePass(this.resources);
        this.skyViewLutPass = this.skyAtmospherePipelines.skyViewLutPipeline.makeComputePass(this.resources);
        this.aerialPerspectiveLutPass = this.skyAtmospherePipelines.aerialPerspectiveLutPipeline.makeComputePass(this.resources);


        const uniformBufferBindGroupLayout = device.createBindGroupLayout({
            label: 'sky atmosphere uniform bind group layout',
            entries: [
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
            ],
        });
        const uniformBufferBindGroup = device.createBindGroup({
            label: 'Uniform buffer bind group',
            layout: uniformBufferBindGroupLayout,
            entries: [
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
            ],
        });

        const samplerBindGroupLayout = device.createBindGroupLayout({
            label: 'sky atmosphere sampler bind group layout',
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    sampler: {
                        type: 'filtering',
                    },
                },
            ],
        });
        const samplerBindGroup = device.createBindGroup({
            label: 'Sampler BindGroup',
            layout: samplerBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: this.resources.lutSampler,
                },
            ],
        });

        // render sky with luts pass - compute
        {
            const renderSkyWithLutsBindGroupLayout = device.createBindGroupLayout({
                label: 'Render sky with luts bind group layout',
                entries: [
                    {
                        binding: 0,
                        visibility: GPUShaderStage.COMPUTE,
                        texture: {
                            sampleType: 'float',
                            viewDimension: this.resources.skyViewLut.texture.dimension,
                            multisampled: false,
                        },
                    },
                    {
                        binding: 1,
                        visibility: GPUShaderStage.COMPUTE,
                        texture: {
                            sampleType: 'float',
                            viewDimension: this.resources.aerialPerspectiveLut.texture.dimension,
                            multisampled: false,
                        },
                    },
                ],
            });

            const externalResourcesBindGroupLayout = device.createBindGroupLayout({
                label: 'Render sky with luts external bind group layout',
                entries: [
                    {
                        binding: 0,
                        visibility: GPUShaderStage.COMPUTE,
                        texture: {
                            sampleType: 'unfilterable-float',
                            viewDimension: config.compute!.depthBuffer.texture.dimension,
                            multisampled: false,
                        },
                    },
                    {
                        binding: 1,
                        visibility: GPUShaderStage.COMPUTE,
                        texture: {
                            sampleType: 'unfilterable-float',
                            viewDimension: config.compute!.backBuffer.texture.dimension,
                            multisampled: false,
                        },
                    },
                    {
                        binding: 2,
                        visibility: GPUShaderStage.COMPUTE,
                        storageTexture: {
                            access: 'write-only',
                            format: config.compute!.renderTarget.texture.format,
                            viewDimension: config.compute!.renderTarget.texture.dimension,
                        },
                    },
                ],
            });

            const renderSkyWithLutsBindGroup = device.createBindGroup({
                label: 'Render sky with LUTs bind group',
                layout: renderSkyWithLutsBindGroupLayout,
                entries: [
                    {
                        binding: 0,
                        resource: this.resources.skyViewLut.view,
                    },
                    {
                        binding: 1,
                        resource: this.resources.aerialPerspectiveLut.view,
                    },
                ],
            });

            const externalResourcesBindGroup = device.createBindGroup({
                label: 'External resources bind group',
                layout: externalResourcesBindGroupLayout,
                entries: [
                    {
                        binding: 0,
                        resource: config.compute!.depthBuffer.view!,
                    },
                    {
                        binding: 1,
                        resource: config.compute!.backBuffer.view!,
                    },
                    {
                        binding: 2,
                        resource: config.compute!.renderTarget.view!,
                    },
                ],
            });

            const renderSkyPipeline = device.createComputePipeline({
                label: 'Render sky with LUTs pipeline',
                layout: device.createPipelineLayout({
                    label: 'Render sky with LUTs pipeline layout',
                    bindGroupLayouts: [
                        uniformBufferBindGroupLayout,
                        samplerBindGroupLayout,
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
                    },
                },
            });

            this.renderSkyWithLutsPass = new ComputePass(
                renderSkyPipeline,
                [uniformBufferBindGroup, samplerBindGroup, renderSkyWithLutsBindGroup, externalResourcesBindGroup],
                [
                    Math.ceil(config.compute!.renderTarget.texture.width / 16.0),
                    Math.ceil(config.compute!.renderTarget.texture.height / 16.0),
                    1,
                ],
            );
        }

        // render sky raymarching - compute
        {
            const renderSkyRaymarchingBindGroupLayout = device.createBindGroupLayout({
                label: 'Render sky raymarching bind group layout',
                entries: [
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

            // todo: reuse from render sky with luts
            const externalResourcesBindGroupLayout = device.createBindGroupLayout({
                label: 'Render sky raymarching external bind group layout',
                entries: [
                    {
                        binding: 0,
                        visibility: GPUShaderStage.COMPUTE,
                        texture: {
                            sampleType: 'unfilterable-float',
                            viewDimension: config.compute!.depthBuffer.texture.dimension,
                            multisampled: false,
                        },
                    },
                    {
                        binding: 1,
                        visibility: GPUShaderStage.COMPUTE,
                        texture: {
                            sampleType: 'unfilterable-float',
                            viewDimension: config.compute!.backBuffer.texture.dimension,
                            multisampled: false,
                        },
                    },
                    {
                        binding: 2,
                        visibility: GPUShaderStage.COMPUTE,
                        storageTexture: {
                            access: 'write-only',
                            format: config.compute!.renderTarget.texture.format,
                            viewDimension: config.compute!.renderTarget.texture.dimension,
                        },
                    },
                ],
            });

            const renderSkyRaymarchingBindGroup = device.createBindGroup({
                label: 'Render sky raymarching bind group',
                layout: renderSkyRaymarchingBindGroupLayout,
                entries: [
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

            const externalResourcesBindGroup = device.createBindGroup({
                label: 'External resources bind group',
                layout: externalResourcesBindGroupLayout,
                entries: [
                    {
                        binding: 0,
                        resource: config.compute!.depthBuffer.view!,
                    },
                    {
                        binding: 1,
                        resource: config.compute!.backBuffer.view!,
                    },
                    {
                        binding: 2,
                        resource: config.compute!.renderTarget.view!,
                    },
                ],
            });

            const renderSkyPipeline = device.createComputePipeline({
                label: 'Render sky raymarching pipeline',
                layout: device.createPipelineLayout({
                    label: 'Render sky raymarching pipeline layout',
                    bindGroupLayouts: [
                        //uniformBufferBindGroupLayout,
                        //samplerBindGroupLayout,
                        renderSkyRaymarchingBindGroupLayout,
                        externalResourcesBindGroupLayout,
                        config.shadow!.bindGroupLayout,
                    ],
                }),
                compute: {
                    module: device.createShaderModule({
                        code: `${config.shadow!.wgslCode}\n${makeRenderSkyRaymarchingShaderCode()}`,
                    }),
                    entryPoint: 'render_sky_atmosphere',
                    constants: {
                    },
                },
            });

            this.renderSkyRaymarchingPass = new ComputePass(
                renderSkyPipeline,
                [renderSkyRaymarchingBindGroup, externalResourcesBindGroup, config.shadow!.bindGroup],
                [
                    Math.ceil(config.compute!.renderTarget.texture.width / 16.0),
                    Math.ceil(config.compute!.renderTarget.texture.height / 16.0),
                    1,
                ],
            );
        }

        if (config.initializeConstantLutsAtCreation) {
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

    public updateConfig(config: Config) {
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
        this.renderSkyWithLutsPass.encode(computePassEncoder);
    }

    public renderSkyRaymarching(computePassEncoder: GPUComputePassEncoder) {
        this.renderSkyRaymarchingPass.encode(computePassEncoder);
    }

    public renderSkyAtmosphere(computePassEncoder: GPUComputePassEncoder, isCameraInSpace: boolean, useColoredTransmittance: boolean, config?: Config, atmosphere?: Atmosphere) {
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
