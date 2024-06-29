import { Atmosphere, makeEarthAtmosphere } from './atmosphere.js';
import { Camera, Config, makeDefaultConfig } from './config.js';

export {
    Atmosphere,
    makeEarthAtmosphere,
    Camera,
    Config,
    makeDefaultConfig,
};

import {
    makeTransmittanceLutShaderCode,
    makeMultiScatteringLutShaderCode,
    makeSkyViewLutShaderCode,
    makeAerialPerspectiveLutShaderCode,
    makeRenderSkyWithLutsShaderCode,
    makeRenderSkyRaymarchingShaderCode,
} from './shaders.js';


const TRANSMITTANCE_LUT_FORMAT: GPUTextureFormat = 'rgba16float';
const MULTI_SCATTERING_LUT_FORMAT: GPUTextureFormat = TRANSMITTANCE_LUT_FORMAT;
const SKY_VIEW_LUT_FORMAT: GPUTextureFormat = TRANSMITTANCE_LUT_FORMAT;
const AERIAL_PERSPECTIVE_LUT_FORMAT: GPUTextureFormat = TRANSMITTANCE_LUT_FORMAT;

const ATMOSPHERE_BUFFER_SIZE: number = 112;
const CONFIG_BUFFER_SIZE: number = 192;

export const DEFAULT_TRANSMITTANCE_LUT_SIZE: [number, number] = [256, 64];
export const DEFAULT_MULTISCATTERING_LUT_SIZE: number = 32;
export const DEFAULT_SKY_VIEW_LUT_SIZE: [number, number] = [192, 108];
export const DEFAULT_AERIAL_PERSPECTIVE_LUT_SIZE: [number, number, number] = [32, 32, 32];

export const DEFAULT_TRANSMITTANCE_LUT_SAMPLE_COUNT: number = 40;
export const DEFAULT_MULTI_SCATTERING_LUT_SAMPLE_COUNT: number = 20;

export interface SkyAtmosphereLutConfig {
    /**
     * Defaults to [256, 64]
     */
    transmittanceLutSize?: [number, number],

    /**
     * Defaults to 40
     * Clamped to max(40, transmittanceLutSampleCount)
     */
    transmittanceLutSampleCount?: number,

    /**
     * Defaults to 32
     */
    multiScatteringLutSize?: number,

    /**
     * Defaults to 20
     * Clamped to max(10, multiScatteringLutSampleCount)
     */
    multiScatteringLutSampleCount?: number,

    /**
     * Defaults to [192, 108]
     */
    skyViewLutSize?: [number, number],

    /**
     * Defaults to [32, 32, 32]
     */
    aerialPerspectiveLutSize?: [number, number, number],
}

function atmosphereToFloatArray(atmosphere: Atmosphere) {
    return new Float32Array([
        atmosphere.rayleigh.scattering[0],
        atmosphere.rayleigh.scattering[1],
        atmosphere.rayleigh.scattering[2],
        atmosphere.rayleigh.densityExpScale,
        atmosphere.mie.scattering[0],
        atmosphere.mie.scattering[1],
        atmosphere.mie.scattering[2],
        atmosphere.mie.densityExpScale,
        atmosphere.mie.extinction[0],
        atmosphere.mie.extinction[1],
        atmosphere.mie.extinction[2],
        atmosphere.mie.phaseG,
        Math.max(atmosphere.mie.extinction[0] - atmosphere.mie.scattering[0], 0.0),
        Math.max(atmosphere.mie.extinction[1] - atmosphere.mie.scattering[1], 0.0),
        Math.max(atmosphere.mie.extinction[2] - atmosphere.mie.scattering[2], 0.0),
        atmosphere.absorption.layer0.width,
        atmosphere.absorption.layer0.constantTerm,
        atmosphere.absorption.layer0.linearTerm,
        atmosphere.absorption.layer1.constantTerm,
        atmosphere.absorption.layer1.linearTerm,
        atmosphere.absorption.extinction[0],
        atmosphere.absorption.extinction[1],
        atmosphere.absorption.extinction[2],
        atmosphere.bottomRadius,
        atmosphere.groundAlbedo[0],
        atmosphere.groundAlbedo[1],
        atmosphere.groundAlbedo[2],
        atmosphere.bottomRadius + Math.max(atmosphere.height, 0.0),
    ]);
}

function configToFloatArray(config: Config) {
    return new Float32Array([
        ...config.camera.inverseProjection,
        ...config.camera.inverseView,
        ...config.sun.illuminance,
        config.rayMarchMinSPP,
        ...config.sun.direction,
        config.rayMarchMaxSPP,
        ...config.camera.position,
        DEFAULT_MULTISCATTERING_LUT_SIZE,
        ...DEFAULT_SKY_VIEW_LUT_SIZE,
        ...config.screenResolution,
    ]);
}

export class LookUpTable {
    readonly texture: GPUTexture;
    readonly view: GPUTextureView;

    constructor(texture: GPUTexture) {
        this.texture = texture;
        this.view = texture.createView();
    }
}

class ComputePass {
    constructor(readonly pipeline: GPUComputePipeline, readonly bindGroups: GPUBindGroup[], readonly dispatchDimensions: [number, number, number]) {}
    encode(computePassEncoder: GPUComputePassEncoder, resetBindGroups: boolean = false) {
        computePassEncoder.setPipeline(this.pipeline);
        for (let i = 0; i < this.bindGroups.length; ++i) {
            computePassEncoder.setBindGroup(i, this.bindGroups[i]);
        }
        computePassEncoder.dispatchWorkgroups(...this.dispatchDimensions);
        if (resetBindGroups) {
            for (let i = 0; i < this.bindGroups.length; ++i) {
                computePassEncoder.setBindGroup(i, null);
            }
        }
    }
}

export interface SkyAtmosphereConfig {
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
    render?: {}
}

export class SkyAtmospherePasses {
    readonly device: GPUDevice;

    readonly atmosphereBuffer: GPUBuffer;
    readonly configBuffer: GPUBuffer;

    readonly lutSampler: GPUSampler;

    readonly transmittanceLut: LookUpTable;
    readonly multiScatteringLut: LookUpTable;
    readonly skyViewLut: LookUpTable;
    readonly aerialPerspectiveLut: LookUpTable;

    private transmittanceLutPass: ComputePass;
    private multiScatteringLutPass: ComputePass;
    private skyViewLutPass: ComputePass;
    private aerialPerspectiveLutPass: ComputePass;

    private renderSkyWithLutsPass: ComputePass;
    private renderSkyRaymarchingPass: ComputePass;

    constructor(device: GPUDevice, config2: SkyAtmosphereConfig = {}, atmosphere: Atmosphere = makeEarthAtmosphere(), lutConfig: SkyAtmosphereLutConfig = {}) {
        this.device = device;

        // init buffers
        {
            this.atmosphereBuffer = device.createBuffer({
                label: 'atmosphere buffer',
                size: ATMOSPHERE_BUFFER_SIZE,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
            this.updateAtmosphere(atmosphere);

            this.configBuffer = device.createBuffer({
                label: 'config buffer',
                size: CONFIG_BUFFER_SIZE,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
            this.updateConfig(makeDefaultConfig());
        }

        // init samplers
        {
            this.lutSampler = device.createSampler({
                label: 'LUT sampler',
                addressModeU: 'clamp-to-edge',
                addressModeV: 'clamp-to-edge',
                addressModeW: 'clamp-to-edge',
                minFilter: 'linear',
                magFilter: 'linear',
                mipmapFilter: 'linear',
                lodMinClamp: 0,
                lodMaxClamp: 32,
                maxAnisotropy: 1,
            });
        }

        // init look up tables
        {
            this.transmittanceLut = new LookUpTable(device.createTexture({
                label: 'transmittance LUT',
                size: lutConfig.transmittanceLutSize || DEFAULT_TRANSMITTANCE_LUT_SIZE, // todo: validate / clamp
                format: TRANSMITTANCE_LUT_FORMAT,
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
            }));

            this.multiScatteringLut = new LookUpTable(device.createTexture({
                label: 'multi scattering LUT',
                size: new Array(2).fill(lutConfig.multiScatteringLutSize || DEFAULT_MULTISCATTERING_LUT_SIZE), // todo: validate / clamp
                format: MULTI_SCATTERING_LUT_FORMAT,
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
            }));

            this.skyViewLut = new LookUpTable(device.createTexture({
                label: 'sky view LUT',
                size: lutConfig.skyViewLutSize || DEFAULT_SKY_VIEW_LUT_SIZE, // todo: validate / clamp
                format: SKY_VIEW_LUT_FORMAT,
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
            }));

            this.aerialPerspectiveLut = new LookUpTable(device.createTexture({
                label: 'aerial perspective LUT',
                size: lutConfig.aerialPerspectiveLutSize || DEFAULT_AERIAL_PERSPECTIVE_LUT_SIZE, // todo: validate / clamp
                format: AERIAL_PERSPECTIVE_LUT_FORMAT,
                dimension: '3d',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
            }));
        }

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
                        buffer: this.atmosphereBuffer,
                    },
                },
                {
                    binding: 1,
                    resource: {
                        buffer: this.configBuffer,
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
                    resource: this.lutSampler,
                },
            ],
        });

        // transmittance lut pass
        {
            const transmittanceLutOutputBindGroupLayout = device.createBindGroupLayout({
                label: 'Transmittance LUT Output BindGroup Layout',
                entries: [
                    {
                        binding: 0,
                        visibility: GPUShaderStage.COMPUTE,
                        storageTexture: {
                            access: 'write-only',
                            format: this.transmittanceLut.texture.format,
                            viewDimension: this.transmittanceLut.texture.dimension,
                        },
                    },
                ],
            });

            const transmittanceLutPipeline = device.createComputePipeline({
                label: 'Transmittance LUT pipeline',
                layout: device.createPipelineLayout({
                    label: 'Transmittance LUT pipeline layout',
                    bindGroupLayouts: [
                        uniformBufferBindGroupLayout,
                        transmittanceLutOutputBindGroupLayout,
                    ],
                }),
                compute: {
                    module: device.createShaderModule({
                        code: makeTransmittanceLutShaderCode(),
                    }),
                    entryPoint: 'render_transmittance_lut',
                    constants: {
                        SAMPLE_COUNT: lutConfig.transmittanceLutSampleCount || DEFAULT_TRANSMITTANCE_LUT_SAMPLE_COUNT,
                    },
                },
            });

            const transmittanceLutOutputBindGroup = device.createBindGroup({
                label: 'Transmittance LUT Ouptut BindGroup',
                layout: transmittanceLutOutputBindGroupLayout,
                entries: [
                    {
                        binding: 0,
                        resource: this.transmittanceLut.view,
                    },
                ],
            });

            this.transmittanceLutPass = new ComputePass(
                transmittanceLutPipeline,
                [uniformBufferBindGroup, transmittanceLutOutputBindGroup],
                [Math.ceil(this.transmittanceLut.texture.width / 16.0), Math.ceil(this.transmittanceLut.texture.height / 16.0), 1],
            );
        }

        // multi scattering lut pass
        {
            const multiScatteringLutBindGroupLayout = device.createBindGroupLayout({
                label: 'Multi Scattering LUT Output BindGroup Layout',
                entries: [
                    {
                        binding: 0,
                        visibility: GPUShaderStage.COMPUTE,
                        texture: {
                            sampleType: 'float',
                            viewDimension: this.transmittanceLut.texture.dimension,
                            multisampled: false,
                        },
                    },
                    {
                        binding: 1,
                        visibility: GPUShaderStage.COMPUTE,
                        storageTexture: {
                            access: 'write-only',
                            format: this.multiScatteringLut.texture.format,
                            viewDimension: this.multiScatteringLut.texture.dimension,
                        },
                    },
                ],
            });
            const multiScatteringLutBindGroup = device.createBindGroup({
                label: 'Multi scattering LUT BindGroup',
                layout: multiScatteringLutBindGroupLayout,
                entries: [
                    {
                        binding: 0,
                        resource: this.transmittanceLut.view,
                    },
                    {
                        binding: 1,
                        resource: this.multiScatteringLut.view,
                    },
                ],
            });

            const multiScatteringLutPipeline = device.createComputePipeline({
                label: 'Multi-Scattering LUT pipeline',
                layout: device.createPipelineLayout({
                    label: 'Multi-Scattering LUT pipeline layout',
                    bindGroupLayouts: [
                        uniformBufferBindGroupLayout,
                        samplerBindGroupLayout,
                        multiScatteringLutBindGroupLayout,
                    ],
                }),
                compute: {
                    module: device.createShaderModule({
                        code: makeMultiScatteringLutShaderCode(),
                    }),
                    entryPoint: 'render_multi_scattering_lut',
                    constants: {
                        SAMPLE_COUNT: lutConfig.multiScatteringLutSampleCount || DEFAULT_MULTI_SCATTERING_LUT_SAMPLE_COUNT,
                    },
                },
            });

            this.multiScatteringLutPass = new ComputePass(
                multiScatteringLutPipeline,
                [uniformBufferBindGroup, samplerBindGroup, multiScatteringLutBindGroup],
                [this.multiScatteringLut.texture.width, this.multiScatteringLut.texture.height, 1],
            );
        }

        // sky view lut pass
        {
            const skyViewLutBindGroupLayout = device.createBindGroupLayout({
                label: 'Sky View LUT BindGroup Layout',
                entries: [
                    {
                        binding: 0,
                        visibility: GPUShaderStage.COMPUTE,
                        texture: {
                            sampleType: 'float',
                            viewDimension: this.transmittanceLut.texture.dimension,
                            multisampled: false,
                        },
                    },
                    {
                        binding: 1,
                        visibility: GPUShaderStage.COMPUTE,
                        texture: {
                            sampleType: 'float',
                            viewDimension: this.multiScatteringLut.texture.dimension,
                            multisampled: false,
                        },
                    },
                    {
                        binding: 2,
                        visibility: GPUShaderStage.COMPUTE,
                        storageTexture: {
                            access: 'write-only',
                            format: this.skyViewLut.texture.format,
                            viewDimension: this.skyViewLut.texture.dimension,
                        },
                    },
                ],
            });
            const skyViewwLutBindGroup = device.createBindGroup({
                label: 'Sky view LUT BindGroup',
                layout: skyViewLutBindGroupLayout,
                entries: [
                    {
                        binding: 0,
                        resource: this.transmittanceLut.view,
                    },
                    {
                        binding: 1,
                        resource: this.multiScatteringLut.view,
                    },
                    {
                        binding: 2,
                        resource: this.skyViewLut.view,
                    },
                ],
            });

            const skyViewLutPipeline = device.createComputePipeline({
                label: 'Sky view LUT pipeline',
                layout: device.createPipelineLayout({
                    label: 'Sky view LUT pipeline layout',
                    bindGroupLayouts: [
                        uniformBufferBindGroupLayout,
                        samplerBindGroupLayout,
                        skyViewLutBindGroupLayout,
                    ],
                }),
                compute: {
                    module: device.createShaderModule({
                        code: makeSkyViewLutShaderCode(),
                    }),
                    entryPoint: 'render_sky_view_lut',
                    constants: {
                        SKY_VIEW_LUT_RES_X: this.skyViewLut.texture.width,
                        SKY_VIEW_LUT_RES_Y: this.skyViewLut.texture.height,
                        MULTI_SCATTERING_LUT_RES: this.multiScatteringLut.texture.width,
                    },
                },
            });

            this.skyViewLutPass = new ComputePass(
                skyViewLutPipeline,
                [uniformBufferBindGroup, samplerBindGroup, skyViewwLutBindGroup],
                [Math.ceil(this.skyViewLut.texture.width / 16.0), Math.ceil(this.skyViewLut.texture.height / 16.0), 1],
            );
        }

        // aerial perspective lut pass
        {
            const aerialPerspectiveLutBindGroupLayout = device.createBindGroupLayout({
                label: 'Aerial perspective LUT BindGroup Layout',
                entries: [
                    {
                        binding: 0,
                        visibility: GPUShaderStage.COMPUTE,
                        texture: {
                            sampleType: 'float',
                            viewDimension: this.transmittanceLut.texture.dimension,
                            multisampled: false,
                        },
                    },
                    {
                        binding: 1,
                        visibility: GPUShaderStage.COMPUTE,
                        texture: {
                            sampleType: 'float',
                            viewDimension: this.multiScatteringLut.texture.dimension,
                            multisampled: false,
                        },
                    },
                    {
                        binding: 2,
                        visibility: GPUShaderStage.COMPUTE,
                        storageTexture: {
                            access: 'write-only',
                            format: this.aerialPerspectiveLut.texture.format,
                            viewDimension: this.aerialPerspectiveLut.texture.dimension,
                        },
                    },
                ],
            });
            const aerialPerspectiveLutBindGroup = device.createBindGroup({
                label: 'Aerial perspective LUT BindGroup',
                layout: aerialPerspectiveLutBindGroupLayout,
                entries: [
                    {
                        binding: 0,
                        resource: this.transmittanceLut.view,
                    },
                    {
                        binding: 1,
                        resource: this.multiScatteringLut.view,
                    },
                    {
                        binding: 2,
                        resource: this.aerialPerspectiveLut.view,
                    },
                ],
            });

            const aerialPerspectiveLutPipeline = device.createComputePipeline({
                label: 'Aerial perspective LUT pipeline',
                layout: device.createPipelineLayout({
                    label: 'Aerial perspective LUT pipeline layout',
                    bindGroupLayouts: [
                        uniformBufferBindGroupLayout,
                        samplerBindGroupLayout,
                        aerialPerspectiveLutBindGroupLayout,
                    ],
                }),
                compute: {
                    module: device.createShaderModule({
                        code: makeAerialPerspectiveLutShaderCode(),
                    }),
                    entryPoint: 'render_aerial_perspective_lut',
                    constants: {
                        MULTI_SCATTERING_LUT_RES: this.multiScatteringLut.texture.width,
                    },
                },
            });

            this.aerialPerspectiveLutPass = new ComputePass(
                aerialPerspectiveLutPipeline,
                [uniformBufferBindGroup, samplerBindGroup, aerialPerspectiveLutBindGroup],
                [
                    Math.ceil(this.aerialPerspectiveLut.texture.width / 16.0),
                    Math.ceil(this.aerialPerspectiveLut.texture.height / 16.0),
                    this.aerialPerspectiveLut.texture.depthOrArrayLayers,
                ],
            );
        }

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
                            viewDimension: this.skyViewLut.texture.dimension,
                            multisampled: false,
                        },
                    },
                    {
                        binding: 1,
                        visibility: GPUShaderStage.COMPUTE,
                        texture: {
                            sampleType: 'float',
                            viewDimension: this.aerialPerspectiveLut.texture.dimension,
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
                            viewDimension: config2.compute!.depthBuffer.texture.dimension,
                            multisampled: false,
                        },
                    },
                    {
                        binding: 1,
                        visibility: GPUShaderStage.COMPUTE,
                        texture: {
                            sampleType: 'unfilterable-float',
                            viewDimension: config2.compute!.backBuffer.texture.dimension,
                            multisampled: false,
                        },
                    },
                    {
                        binding: 2,
                        visibility: GPUShaderStage.COMPUTE,
                        storageTexture: {
                            access: 'write-only',
                            format: config2.compute!.renderTarget.texture.format,
                            viewDimension: config2.compute!.renderTarget.texture.dimension,
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
                        resource: this.skyViewLut.view,
                    },
                    {
                        binding: 1,
                        resource: this.aerialPerspectiveLut.view,
                    },
                ],
            });

            const externalResourcesBindGroup = device.createBindGroup({
                label: 'External resources bind group',
                layout: externalResourcesBindGroupLayout,
                entries: [
                    {
                        binding: 0,
                        resource: config2.compute!.depthBuffer.view!,
                    },
                    {
                        binding: 1,
                        resource: config2.compute!.backBuffer.view!,
                    },
                    {
                        binding: 2,
                        resource: config2.compute!.renderTarget.view!,
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
                    Math.ceil(config2.compute!.renderTarget.texture.width / 16.0),
                    Math.ceil(config2.compute!.renderTarget.texture.height / 16.0),
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
                        texture: {
                            sampleType: 'float',
                            viewDimension: this.transmittanceLut.texture.dimension,
                            multisampled: false,
                        },
                    },
                    {
                        binding: 1,
                        visibility: GPUShaderStage.COMPUTE,
                        texture: {
                            sampleType: 'float',
                            viewDimension: this.multiScatteringLut.texture.dimension,
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
                            viewDimension: config2.compute!.depthBuffer.texture.dimension,
                            multisampled: false,
                        },
                    },
                    {
                        binding: 1,
                        visibility: GPUShaderStage.COMPUTE,
                        texture: {
                            sampleType: 'unfilterable-float',
                            viewDimension: config2.compute!.backBuffer.texture.dimension,
                            multisampled: false,
                        },
                    },
                    {
                        binding: 2,
                        visibility: GPUShaderStage.COMPUTE,
                        storageTexture: {
                            access: 'write-only',
                            format: config2.compute!.renderTarget.texture.format,
                            viewDimension: config2.compute!.renderTarget.texture.dimension,
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
                        resource: this.transmittanceLut.view,
                    },
                    {
                        binding: 1,
                        resource: this.multiScatteringLut.view,
                    },
                ],
            });

            const externalResourcesBindGroup = device.createBindGroup({
                label: 'External resources bind group',
                layout: externalResourcesBindGroupLayout,
                entries: [
                    {
                        binding: 0,
                        resource: config2.compute!.depthBuffer.view!,
                    },
                    {
                        binding: 1,
                        resource: config2.compute!.backBuffer.view!,
                    },
                    {
                        binding: 2,
                        resource: config2.compute!.renderTarget.view!,
                    },
                ],
            });

            const renderSkyPipeline = device.createComputePipeline({
                label: 'Render sky raymarching pipeline',
                layout: device.createPipelineLayout({
                    label: 'Render sky raymarching pipeline layout',
                    bindGroupLayouts: [
                        uniformBufferBindGroupLayout,
                        samplerBindGroupLayout,
                        renderSkyRaymarchingBindGroupLayout,
                        externalResourcesBindGroupLayout,
                    ],
                }),
                compute: {
                    module: device.createShaderModule({
                        code: makeRenderSkyRaymarchingShaderCode(),
                    }),
                    entryPoint: 'render_sky_atmosphere',
                    constants: {
                    },
                },
            });

            this.renderSkyRaymarchingPass = new ComputePass(
                renderSkyPipeline,
                [uniformBufferBindGroup, samplerBindGroup, renderSkyRaymarchingBindGroup, externalResourcesBindGroup],
                [
                    Math.ceil(config2.compute!.renderTarget.texture.width / 16.0),
                    Math.ceil(config2.compute!.renderTarget.texture.height / 16.0),
                    1,
                ],
            );
        }

        if (config2.initializeConstantLutsAtCreation) {
            const commandEncoder = device.createCommandEncoder();
            const computePassEncoder = commandEncoder.beginComputePass();
            this.transmittanceLutPass.encode(computePassEncoder);
            this.multiScatteringLutPass.encode(computePassEncoder);
            computePassEncoder.end();
            device.queue.submit([commandEncoder.finish()]);
        }
    }

    public updateAtmosphere(atmosphere: Atmosphere) {
        this.device.queue.writeBuffer(this.atmosphereBuffer, 0, new Float32Array(atmosphereToFloatArray(atmosphere)));
    }

    public updateConfig(config: Config) {
        this.device.queue.writeBuffer(this.configBuffer, 0, new Float32Array(configToFloatArray(config)));
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
