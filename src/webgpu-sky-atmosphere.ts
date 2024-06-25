import { Atmosphere } from './atmosphere.js';
import { Camera, Config } from './config.js';

import {
    makeTransmittanceLutShaderCode,
    makeMultiScatteringLutShaderCode,
    makeSkyViewLutShaderCode,
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
        atmosphere.rayleighComponent.scattering[0],
        atmosphere.rayleighComponent.scattering[1],
        atmosphere.rayleighComponent.scattering[2],
        atmosphere.rayleighComponent.densityExpScale,
        atmosphere.mieComponent.scattering[0],
        atmosphere.mieComponent.scattering[1],
        atmosphere.mieComponent.scattering[2],
        atmosphere.mieComponent.densityExpScale,
        atmosphere.mieComponent.extinction[0],
        atmosphere.mieComponent.extinction[1],
        atmosphere.mieComponent.extinction[2],
        atmosphere.mieComponent.phaseG,
        Math.max(atmosphere.mieComponent.extinction[0] - atmosphere.mieComponent.scattering[0], 0.0),
        Math.max(atmosphere.mieComponent.extinction[1] - atmosphere.mieComponent.scattering[1], 0.0),
        Math.max(atmosphere.mieComponent.extinction[2] - atmosphere.mieComponent.scattering[2], 0.0),
        atmosphere.apsorptionComponent.layer0.width,
        atmosphere.apsorptionComponent.layer0.constantTerm,
        atmosphere.apsorptionComponent.layer0.linearTerm,
        atmosphere.apsorptionComponent.layer1.constantTerm,
        atmosphere.apsorptionComponent.layer1.linearTerm,
        atmosphere.apsorptionComponent.extinction[0],
        atmosphere.apsorptionComponent.extinction[1],
        atmosphere.apsorptionComponent.extinction[2],
        atmosphere.bottomRadius,
        atmosphere.groundAlbedo[0],
        atmosphere.groundAlbedo[1],
        atmosphere.groundAlbedo[2],
        atmosphere.bottomRadius + atmosphere.height,
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

export class SkyAtmospherePasses {
    readonly device: GPUDevice;

    readonly atmosphereBuffer: GPUBuffer;
    readonly configBuffer: GPUBuffer;

    readonly lutSampler: GPUSampler;

    readonly transmittanceLut: LookUpTable;
    readonly multiScatteringLut: LookUpTable;
    readonly skyViewLut: LookUpTable;
    readonly aerialPerspectiveLut: LookUpTable;


    constructor(device: GPUDevice, atmosphere: Atmosphere = Atmosphere.earth(), lutConfig: SkyAtmosphereLutConfig = {}) {
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
            this.updateConfig(new Config());
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


    }

    public updateAtmosphere(atmosphere: Atmosphere) {
        this.device.queue.writeBuffer(this.atmosphereBuffer, 0, new Float32Array(atmosphereToFloatArray(atmosphere)));
    }

    public updateConfig(config: Config) {
        this.device.queue.writeBuffer(this.configBuffer, 0, new Float32Array(configToFloatArray(config)));
    }

    public renderTransmittanceLut(computePassEncoder: GPUComputePassEncoder) {}

    public renderMultiScatteringLut(computePassEncoder: GPUComputePassEncoder) {}

    public renderAerialPerspective(computePassEncoder: GPUComputePassEncoder) {}
}

export function foo(device: GPUDevice, viewMat: number[], projMat: number[], lutConfig: SkyAtmosphereLutConfig = {}): GPUTextureView[] {
    const transmittanceLut = device.createTexture({
        label: 'transmittance LUT',
        size: lutConfig.transmittanceLutSize || DEFAULT_TRANSMITTANCE_LUT_SIZE, // todo: validate / clamp
        format: TRANSMITTANCE_LUT_FORMAT,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });
    const transmittanceLutView = transmittanceLut.createView();

    const multiScatteringLut = device.createTexture({
        label: 'multi scattering LUT',
        size: new Array(2).fill(lutConfig.multiScatteringLutSize || DEFAULT_MULTISCATTERING_LUT_SIZE), // todo: validate / clamp
        format: MULTI_SCATTERING_LUT_FORMAT,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });
    const multiScatteringLutView = multiScatteringLut.createView();

    const skyViewLut = device.createTexture({
        label: 'Sky view LUT',
        size: lutConfig.skyViewLutSize || DEFAULT_SKY_VIEW_LUT_SIZE, // todo: validate / clamp
        format: SKY_VIEW_LUT_FORMAT,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });
    const skyViewLutView = skyViewLut.createView();

    const atmosphereBufferBindGroupLayout = device.createBindGroupLayout({
        label: 'Atmosphere buffer bind group layout',
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
        ],
    });

    const samplerBindGroupLayout = device.createBindGroupLayout({
        label: 'Sampler bind group layout',
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

    const transmittanceLutOutputBindGroupLayout = device.createBindGroupLayout({
        label: 'Transmittance LUT Output BindGroup Layout',
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.COMPUTE,
                storageTexture: {
                    access: 'write-only',
                    format: transmittanceLut.format,
                    viewDimension: transmittanceLut.dimension,
                },
            },
        ],
    });

    const transmittanceLutPipeline = device.createComputePipeline({
        label: 'Transmittance LUT pipeline',
        layout: device.createPipelineLayout({
            label: 'Transmittance LUT pipeline layout',
            bindGroupLayouts: [
                atmosphereBufferBindGroupLayout,
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

    // Multiscattering start
    const multiScatteringLutBindGroupLayout = device.createBindGroupLayout({
        label: 'Multi Scattering LUT Output BindGroup Layout',
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.COMPUTE,
                texture: {
                    sampleType: 'float',
                    viewDimension: transmittanceLut.dimension,
                    multisampled: false,
                },
            },
            {
                binding: 1,
                visibility: GPUShaderStage.COMPUTE,
                storageTexture: {
                    access: 'write-only',
                    format: multiScatteringLut.format,
                    viewDimension: multiScatteringLut.dimension,
                },
            },
        ],
    });

    const multiScatteringLutPipeline = device.createComputePipeline({
        label: 'Multi-Scattering LUT pipeline',
        layout: device.createPipelineLayout({
            label: 'Multi-Scattering LUT pipeline layout',
            bindGroupLayouts: [
                atmosphereBufferBindGroupLayout,
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

    // Multiscattering end

    const uniformBufferBindGroupLayout = device.createBindGroupLayout({
        label: 'Sky atmosphere buffer bind group layout',
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

    // Sky View start

    const skyViewLutBindGroupLayout = device.createBindGroupLayout({
        label: 'Sky View LUT BindGroup Layout',
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.COMPUTE,
                texture: {
                    sampleType: 'float',
                    viewDimension: transmittanceLut.dimension,
                    multisampled: false,
                },
            },
            {
                binding: 1,
                visibility: GPUShaderStage.COMPUTE,
                texture: {
                    sampleType: 'float',
                    viewDimension: multiScatteringLut.dimension,
                    multisampled: false,
                },
            },
            {
                binding: 2,
                visibility: GPUShaderStage.COMPUTE,
                storageTexture: {
                    access: 'write-only',
                    format: skyViewLut.format,
                    viewDimension: skyViewLut.dimension,
                },
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
                SKY_VIEW_LUT_RES_X: skyViewLut.width,
                SKY_VIEW_LUT_RES_Y: skyViewLut.height,
                MULTI_SCATTERING_LUT_RES: multiScatteringLut.width,
            },
        },
    });

    // Sky View end

    const atmosphereBuffer = device.createBuffer({
        label: 'Atmosphere buffer',
        size: ATMOSPHERE_BUFFER_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(atmosphereBuffer, 0, new Float32Array(atmosphereToFloatArray(Atmosphere.earth())));

    const configBuffer = device.createBuffer({
        label: 'Config buffer',
        size: CONFIG_BUFFER_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const config = new Config();
    config.camera.inverseView = viewMat;
    config.camera.inverseProjection = projMat;
    device.queue.writeBuffer(configBuffer, 0, new Float32Array(configToFloatArray(config)));

    const atmosphereBufferBindGroup = device.createBindGroup({
        label: 'Atmosphere buffer bind group',
        layout: atmosphereBufferBindGroupLayout,
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: atmosphereBuffer,
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
                    buffer: atmosphereBuffer,
                },
            },
            {
                binding: 1,
                resource: {
                    buffer: configBuffer,
                },
            },
        ],
    });

    const lutSampler = device.createSampler({
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

    const samplerBindGroup = device.createBindGroup({
        label: 'Sampler BindGroup',
        layout: samplerBindGroupLayout,
        entries: [
            {
                binding: 0,
                resource: lutSampler,
            },
        ],
    });

    const transmittanceLutOutputBindGroup = device.createBindGroup({
        label: 'Transmittance LUT Ouptut BindGroup',
        layout: transmittanceLutOutputBindGroupLayout,
        entries: [
            {
                binding: 0,
                resource: transmittanceLutView,
            },
        ],
    });

    const multiScatteringLutBindGroup = device.createBindGroup({
        label: 'Multi scattering LUT BindGroup',
        layout: multiScatteringLutBindGroupLayout,
        entries: [
            {
                binding: 0,
                resource: transmittanceLutView,
            },
            {
                binding: 1,
                resource: multiScatteringLutView,
            },
        ],
    });

    const skyViewwLutBindGroup = device.createBindGroup({
        label: 'Sky view LUT BindGroup',
        layout: skyViewLutBindGroupLayout,
        entries: [
            {
                binding: 0,
                resource: transmittanceLutView,
            },
            {
                binding: 1,
                resource: multiScatteringLutView,
            },
            {
                binding: 2,
                resource: skyViewLutView,
            },
        ],
    });

    const commandEncoder = device.createCommandEncoder({
        label: 'Atmosphere command encoder',
    });

    const transmittanceLutComputePass = commandEncoder.beginComputePass({
        label: 'Transmittance LUT pass',
    });
    transmittanceLutComputePass.setPipeline(transmittanceLutPipeline);
    transmittanceLutComputePass.setBindGroup(0, atmosphereBufferBindGroup);
    transmittanceLutComputePass.setBindGroup(1, transmittanceLutOutputBindGroup);
    transmittanceLutComputePass.dispatchWorkgroups(Math.ceil(transmittanceLut.width / 16.0), Math.ceil(transmittanceLut.height / 16.0));
    transmittanceLutComputePass.end();

    const multiScatteringComputePass = commandEncoder.beginComputePass({
        label: 'Multi Scattering LUT pass',
    });
    multiScatteringComputePass.setPipeline(multiScatteringLutPipeline);
    multiScatteringComputePass.setBindGroup(0, atmosphereBufferBindGroup);
    multiScatteringComputePass.setBindGroup(1, samplerBindGroup);
    multiScatteringComputePass.setBindGroup(2, multiScatteringLutBindGroup);
    multiScatteringComputePass.dispatchWorkgroups(multiScatteringLut.width, multiScatteringLut.height, 1);
    multiScatteringComputePass.end();

    // todo: also add a renderpass version
    const skyViewComputePass = commandEncoder.beginComputePass({
        label: 'Sky view LUT pass',
    });
    skyViewComputePass.setPipeline(skyViewLutPipeline);
    skyViewComputePass.setBindGroup(0, uniformBufferBindGroup);
    skyViewComputePass.setBindGroup(1, samplerBindGroup);
    skyViewComputePass.setBindGroup(2, skyViewwLutBindGroup);
    skyViewComputePass.dispatchWorkgroups(Math.ceil(skyViewLut.width / 16.0), Math.ceil(skyViewLut.height / 16.0));
    skyViewComputePass.end();

    device.queue.submit([commandEncoder.finish()]);

    return [
        transmittanceLutView,
        multiScatteringLutView,
        skyViewLutView,
    ];
}
