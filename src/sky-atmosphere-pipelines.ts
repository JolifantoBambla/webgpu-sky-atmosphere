import { makeAerialPerspectiveLutShaderCode, makeMultiScatteringLutShaderCode, makeSkyViewLutShaderCode, makeTransmittanceLutShaderCode } from "./shaders.js";

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

export class SkyAtmospherePipelines {
    readonly lutSampler: GPUSampler;

    readonly transmittanceLutPipeline: TransmittanceLutPipeline;
    readonly multiScatteringLutPipeline: MultiScatteringLutPipeline;
    readonly skyViewLutPipeline: SkyViewLutPipeline;
    readonly aerialPerspectiveLutPipeline: AerialPerspectiveLutPipeline;
    
    constructor(device: GPUDevice) {
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

        this.transmittanceLutPipeline = new TransmittanceLutPipeline(device);
        this.multiScatteringLutPipeline = new MultiScatteringLutPipeline(device);
        this.skyViewLutPipeline = new SkyViewLutPipeline(device);
        this.aerialPerspectiveLutPipeline = new AerialPerspectiveLutPipeline(device);

    }
}

export class TransmittanceLutPipeline {
    readonly pipeline: GPUComputePipeline;
    readonly bindGroupLayout: GPUBindGroupLayout;
    readonly transmittanceLutFormat: GPUTextureFormat;

    constructor(device: GPUDevice, transmittanceLutFormat: GPUTextureFormat = TRANSMITTANCE_LUT_FORMAT, sampleCount: number = DEFAULT_TRANSMITTANCE_LUT_SAMPLE_COUNT) {
        this.transmittanceLutFormat = transmittanceLutFormat;
        this.bindGroupLayout = device.createBindGroupLayout({
            label: 'transmittance LUT pass',
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
                    storageTexture: {
                        access: 'write-only',
                        format: transmittanceLutFormat,
                        viewDimension: '2d',
                    },
                },
            ],
        });
        this.pipeline = device.createComputePipeline({
            label: 'transmittance LUT pass',
            layout: device.createPipelineLayout({
                label: 'transmittance LUT pass',
                bindGroupLayouts: [this.bindGroupLayout],
            }),
            compute: {
                module: device.createShaderModule({
                    code: makeTransmittanceLutShaderCode(),
                }),
                entryPoint: 'render_transmittance_lut',
                constants: {
                    SAMPLE_COUNT: Math.max(sampleCount, DEFAULT_TRANSMITTANCE_LUT_SAMPLE_COUNT),
                },
            },
        });
    }

    makeBindGroup(device: GPUDevice, resources: {label?: string, atmosphereBuffer: GPUBuffer, transmittanceLut: GPUTexture}): GPUBindGroup {
        if (resources.atmosphereBuffer.size < ATMOSPHERE_BUFFER_SIZE) {
            throw new Error(`[TransmittanceLutPipeline::makeBindGroup]: buffer too small for atmosphere parameters (${resources.atmosphereBuffer.size} < ${ATMOSPHERE_BUFFER_SIZE})`);
        }
        if (resources.transmittanceLut.format !== this.transmittanceLutFormat) {
            throw new Error(`[TransmittanceLutPipeline::makeBindGroup]: wrong texture format for transmittance LUT. expected '${TRANSMITTANCE_LUT_FORMAT}', got ${resources.transmittanceLut.format}`);
        }
        return device.createBindGroup({
            label: resources.label || 'transmittance LUT pass',
            layout: this.bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: resources.atmosphereBuffer,
                    },
                },
                {
                    binding: 1,
                    resource: resources.transmittanceLut.createView(),
                },
            ],
        });
    }
}

export class MultiScatteringLutPipeline {
    readonly pipeline: GPUComputePipeline;
    readonly bindGroupLayout: GPUBindGroupLayout;
    readonly multiScatteringLutFormat: GPUTextureFormat;

    constructor(device: GPUDevice, multiScatteringLutFormat: GPUTextureFormat = MULTI_SCATTERING_LUT_FORMAT, sampleCount: number = DEFAULT_MULTI_SCATTERING_LUT_SAMPLE_COUNT) {
        this.multiScatteringLutFormat = multiScatteringLutFormat;
        this.bindGroupLayout = device.createBindGroupLayout({
            label: 'mulitple scattering LUT pass',
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
                    sampler: {
                        type: 'filtering',
                    },
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.COMPUTE,
                    texture: {
                        sampleType: 'float',
                        viewDimension: '2d',
                        multisampled: false,
                    },
                },
                {
                    binding: 3,
                    visibility: GPUShaderStage.COMPUTE,
                    storageTexture: {
                        access: 'write-only',
                        format: this.multiScatteringLutFormat,
                        viewDimension: '2d',
                    },
                },
            ],
        });
        this.pipeline = device.createComputePipeline({
            label: 'mulitple scattering LUT pass',
            layout: device.createPipelineLayout({
                label: 'mulitple scattering LUT pass',
                bindGroupLayouts: [this.bindGroupLayout],
            }),
            compute: {
                module: device.createShaderModule({
                    code: makeMultiScatteringLutShaderCode(),
                }),
                entryPoint: 'render_multi_scattering_lut',
                constants: {
                    SAMPLE_COUNT: Math.max(sampleCount, 10),
                },
            },
        });
    }

    makeBindGroup(device: GPUDevice, resources: {label?: string, atmosphereBuffer: GPUBuffer, lutSampler: GPUSampler, transmittanceLutView: GPUTextureView, multiScatteringLut: GPUTexture}): GPUBindGroup {
        if (resources.atmosphereBuffer.size < ATMOSPHERE_BUFFER_SIZE) {
            throw new Error(`[MultiScatteringLutPipeline::makeBindGroup]: buffer too small for atmosphere parameters (${resources.atmosphereBuffer.size} < ${ATMOSPHERE_BUFFER_SIZE})`);
        }
        if (resources.multiScatteringLut.format !== this.multiScatteringLutFormat) {
            throw new Error(`[MultiScatteringLutPipeline::makeBindGroup]: wrong texture format for multiple scattering LUT. expected '${MULTI_SCATTERING_LUT_FORMAT}', got ${resources.multiScatteringLut.format}`);
        }
        return device.createBindGroup({
            label: resources.label ||  'mulitple scattering LUT pass',
            layout: this.bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: resources.atmosphereBuffer,
                    },
                },
                {
                    binding: 1,
                    resource: resources.lutSampler,
                },
                {
                    binding: 2,
                    resource: resources.transmittanceLutView,
                },
                {
                    binding: 3,
                    resource: resources.multiScatteringLut.createView(),
                },
            ],
        });
    }
}

export class SkyViewLutPipeline {
    readonly pipeline: GPUComputePipeline;
    readonly bindGroupLayout: GPUBindGroupLayout;
    readonly skyViewLutFormat: GPUTextureFormat;
    readonly skyViewLutSize: [number, number];
    readonly multiscatteringLutSize: number;

    constructor(device: GPUDevice, skyViewLutFormat: GPUTextureFormat = SKY_VIEW_LUT_FORMAT, skyViewLutSize: [number, number] = DEFAULT_SKY_VIEW_LUT_SIZE, multiscatteringLutSize: number = DEFAULT_MULTISCATTERING_LUT_SIZE) {
        this.skyViewLutFormat = skyViewLutFormat;
        this.skyViewLutSize = skyViewLutSize;
        this.multiscatteringLutSize = multiscatteringLutSize;
        this.bindGroupLayout = device.createBindGroupLayout({
            label: 'sky view LUT pass',
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
                        viewDimension: '2d',
                        multisampled: false,
                    },
                },
                {
                    binding: 4,
                    visibility: GPUShaderStage.COMPUTE,
                    texture: {
                        sampleType: 'float',
                        viewDimension: '2d',
                        multisampled: false,
                    },
                },
                {
                    binding: 5,
                    visibility: GPUShaderStage.COMPUTE,
                    storageTexture: {
                        access: 'write-only',
                        format: this.skyViewLutFormat,
                        viewDimension: '2d',
                    },
                },
            ],
        });
        this.pipeline = device.createComputePipeline({
            label: 'sky view LUT pass',
            layout: device.createPipelineLayout({
                label: 'sky view LUT pass',
                bindGroupLayouts: [this.bindGroupLayout],
            }),
            compute: {
                module: device.createShaderModule({
                    code: makeSkyViewLutShaderCode(),
                }),
                entryPoint: 'render_sky_view_lut',
                constants: {
                    SKY_VIEW_LUT_RES_X: this.skyViewLutSize[0],
                    SKY_VIEW_LUT_RES_Y: this.skyViewLutSize[1],
                    MULTI_SCATTERING_LUT_RES: this.multiscatteringLutSize,
                },
            },
        });
    }

    makeBindGroup(device: GPUDevice, resources: {label?: string, atmosphereBuffer: GPUBuffer, configBuffer: GPUBuffer, lutSampler: GPUSampler, transmittanceLutView: GPUTextureView, multiScatteringLutView: GPUTextureView, skyViewLut: GPUTexture}): GPUBindGroup {
        if (resources.atmosphereBuffer.size < ATMOSPHERE_BUFFER_SIZE) {
            throw new Error(`[SkyViewLutPipeline::makeBindGroup]: buffer too small for atmosphere parameters (${resources.configBuffer.size} < ${CONFIG_BUFFER_SIZE})`);
        }
        if (resources.configBuffer.size < CONFIG_BUFFER_SIZE) {
            throw new Error(`[SkyViewLutPipeline::makeBindGroup]: buffer too small for config (${resources.atmosphereBuffer.size} < ${ATMOSPHERE_BUFFER_SIZE})`);
        }
        if (resources.skyViewLut.format !== this.skyViewLutFormat) {
            throw new Error(`[SkyViewLutPipeline::makeBindGroup]: wrong texture format for sky view LUT. expected '${SKY_VIEW_LUT_FORMAT}', got ${resources.skyViewLut.format}`);
        }
        if (resources.skyViewLut.width !== this.skyViewLutSize[0] || resources.skyViewLut.height !== this.skyViewLutSize[1]) {
            throw new Error(`[SkyViewLutPipeline::makeBindGroup]: wrong texture size for sky view LUT. expected '${this.skyViewLutSize}', got ${[resources.skyViewLut.width, resources.skyViewLut.height]}`);
        }
        return device.createBindGroup({
            label: resources.label ||  'sky view LUT pass',
            layout: this.bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: resources.atmosphereBuffer,
                    },
                },
                {
                    binding: 1,
                    resource: {
                        buffer: resources.configBuffer,
                    },
                },
                {
                    binding: 2,
                    resource: resources.lutSampler,
                },
                {
                    binding: 3,
                    resource: resources.transmittanceLutView,
                },
                {
                    binding: 4,
                    resource: resources.multiScatteringLutView,
                },
                {
                    binding: 5,
                    resource: resources.skyViewLut.createView(),
                },
            ],
        });
    }
}

export class AerialPerspectiveLutPipeline {
    readonly pipeline: GPUComputePipeline;
    readonly bindGroupLayout: GPUBindGroupLayout;
    readonly aerialPerspectiveLutFormat: GPUTextureFormat;
    readonly multiscatteringLutSize: number;

    constructor(device: GPUDevice, aerialPerspectiveLutFormat: GPUTextureFormat = AERIAL_PERSPECTIVE_LUT_FORMAT, multiscatteringLutSize: number = DEFAULT_MULTISCATTERING_LUT_SIZE) {
        this.aerialPerspectiveLutFormat = aerialPerspectiveLutFormat;
        this.multiscatteringLutSize = multiscatteringLutSize;
        this.bindGroupLayout = device.createBindGroupLayout({
            label: 'aerial perspective LUT pass',
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
                        viewDimension: '2d',
                        multisampled: false,
                    },
                },
                {
                    binding: 4,
                    visibility: GPUShaderStage.COMPUTE,
                    texture: {
                        sampleType: 'float',
                        viewDimension: '2d',
                        multisampled: false,
                    },
                },
                {
                    binding: 5,
                    visibility: GPUShaderStage.COMPUTE,
                    storageTexture: {
                        access: 'write-only',
                        format: this.aerialPerspectiveLutFormat,
                        viewDimension: '3d',
                    },
                },
            ],
        });
        this.pipeline = device.createComputePipeline({
            label: 'aerial perspective LUT pass',
            layout: device.createPipelineLayout({
                label: 'aerial perspective LUT pass',
                bindGroupLayouts: [this.bindGroupLayout],
            }),
            compute: {
                module: device.createShaderModule({
                    code: makeAerialPerspectiveLutShaderCode(),
                }),
                entryPoint: 'render_aerial_perspective_lut',
                constants: {
                    MULTI_SCATTERING_LUT_RES: this.multiscatteringLutSize,
                },
            },
        });
    }

    makeBindGroup(device: GPUDevice, resources: {label?: string, atmosphereBuffer: GPUBuffer, configBuffer: GPUBuffer, lutSampler: GPUSampler, transmittanceLutView: GPUTextureView, multiScatteringLutView: GPUTextureView, aerialPerspectiveLut: GPUTexture}): GPUBindGroup {
        if (resources.atmosphereBuffer.size < ATMOSPHERE_BUFFER_SIZE) {
            throw new Error(`[AerialPerspectiveLutPipeline::makeBindGroup]: buffer too small for atmosphere parameters (${resources.configBuffer.size} < ${CONFIG_BUFFER_SIZE})`);
        }
        if (resources.configBuffer.size < CONFIG_BUFFER_SIZE) {
            throw new Error(`[AerialPerspectiveLutPipeline::makeBindGroup]: buffer too small for config (${resources.atmosphereBuffer.size} < ${ATMOSPHERE_BUFFER_SIZE})`);
        }
        if (resources.aerialPerspectiveLut.format !== this.aerialPerspectiveLutFormat) {
            throw new Error(`[AerialPerspectiveLutPipeline::makeBindGroup]: wrong texture format for aerial perspective LUT. expected '${this.aerialPerspectiveLutFormat}', got ${resources.aerialPerspectiveLut.format}`);
        }
        return device.createBindGroup({
            label: resources.label ||  'aerial perspective LUT pass',
            layout: this.bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: resources.atmosphereBuffer,
                    },
                },
                {
                    binding: 1,
                    resource: {
                        buffer: resources.configBuffer,
                    },
                },
                {
                    binding: 2,
                    resource: resources.lutSampler,
                },
                {
                    binding: 3,
                    resource: resources.transmittanceLutView,
                },
                {
                    binding: 4,
                    resource: resources.multiScatteringLutView,
                },
                {
                    binding: 5,
                    resource: resources.aerialPerspectiveLut.createView(),
                },
            ],
        });
    }
}
