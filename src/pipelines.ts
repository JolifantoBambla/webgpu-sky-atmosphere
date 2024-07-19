import { SkyAtmosphereConfig, ShadowConfig } from './config.js';
import { AERIAL_PERSPECTIVE_LUT_FORMAT, ATMOSPHERE_BUFFER_SIZE, UNIFORMS_BUFFER_SIZE, DEFAULT_AERIAL_PERSPECTIVE_LUT_SIZE, DEFAULT_MULTISCATTERING_LUT_SIZE, DEFAULT_SKY_VIEW_LUT_SIZE, MULTI_SCATTERING_LUT_FORMAT, SKY_VIEW_LUT_FORMAT, SkyAtmosphereResources, TRANSMITTANCE_LUT_FORMAT } from './resources.js';
import { makeAerialPerspectiveLutShaderCode, makeMultiScatteringLutShaderCode, makeSkyViewLutShaderCode, makeTransmittanceLutShaderCode } from './shaders.js';
import { ComputePass } from './util.js';

export const DEFAULT_TRANSMITTANCE_LUT_SAMPLE_COUNT: number = 40;
export const DEFAULT_MULTI_SCATTERING_LUT_SAMPLE_COUNT: number = 20;
export const MULTI_SCATTERING_LUT_MIN_SAMPLE_COUNT: number = 10;

export class SkyAtmospherePipelines {
    readonly transmittanceLutPipeline: TransmittanceLutPipeline;
    readonly multiScatteringLutPipeline: MultiScatteringLutPipeline;
    readonly skyViewLutPipeline: SkyViewLutPipeline;
    readonly aerialPerspectiveLutPipeline: AerialPerspectiveLutPipeline;

    constructor(device: GPUDevice, config: SkyAtmosphereConfig) {
        this.transmittanceLutPipeline = new TransmittanceLutPipeline(
            device,
            config.lookUpTables?.transmittanceLut?.format ?? TRANSMITTANCE_LUT_FORMAT,
            config.lookUpTables?.transmittanceLut?.sampleCount ?? DEFAULT_TRANSMITTANCE_LUT_SAMPLE_COUNT,
        );
        this.multiScatteringLutPipeline = new MultiScatteringLutPipeline(
            device,
            config.lookUpTables?.multiScatteringLut?.format ?? MULTI_SCATTERING_LUT_FORMAT,
            config.lookUpTables?.multiScatteringLut?.sampleCount ?? DEFAULT_MULTI_SCATTERING_LUT_SAMPLE_COUNT,
        );
        this.skyViewLutPipeline = new SkyViewLutPipeline(
            device,
            config.lookUpTables?.skyViewLut?.format ?? SKY_VIEW_LUT_FORMAT,
            config.lookUpTables?.skyViewLut?.size ?? DEFAULT_SKY_VIEW_LUT_SIZE,
            config.lookUpTables?.multiScatteringLut?.size ?? [DEFAULT_MULTISCATTERING_LUT_SIZE, DEFAULT_MULTISCATTERING_LUT_SIZE],
            config.skyRenderer.distanceToMaxSampleCount ?? (100.0 * (config.distanceScaleFactor ?? 1.0)),
            config.lights?.useMoon ?? false,
            (config.lookUpTables?.skyViewLut?.affectedByShadow ?? true) ? config.shadow : undefined,
        );
        this.aerialPerspectiveLutPipeline = new AerialPerspectiveLutPipeline(
            device,
            config.lookUpTables?.aerialPerspectiveLut?.format ?? AERIAL_PERSPECTIVE_LUT_FORMAT,
            (config.lookUpTables?.aerialPerspectiveLut?.size ?? DEFAULT_AERIAL_PERSPECTIVE_LUT_SIZE)[2],
            config.lookUpTables?.aerialPerspectiveLut?.distancePerSlice ?? (4.0 * (config.distanceScaleFactor ?? 1.0)),
            config.lookUpTables?.multiScatteringLut?.size ?? [DEFAULT_MULTISCATTERING_LUT_SIZE, DEFAULT_MULTISCATTERING_LUT_SIZE],
            config.lights?.useMoon ?? false,
            config.shadow,
        );
    }
}

export class TransmittanceLutPipeline {
    readonly device: GPUDevice;
    readonly pipeline: GPUComputePipeline;
    readonly bindGroupLayout: GPUBindGroupLayout;
    readonly transmittanceLutFormat: GPUTextureFormat;

    constructor(device: GPUDevice, transmittanceLutFormat: GPUTextureFormat, sampleCount: number) {
        this.device = device;
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
                    code: makeTransmittanceLutShaderCode(transmittanceLutFormat),
                }),
                entryPoint: 'render_transmittance_lut',
                constants: {
                    SAMPLE_COUNT: Math.max(sampleCount, DEFAULT_TRANSMITTANCE_LUT_SAMPLE_COUNT),
                },
            },
        });
    }

    public makeComputePass(resources: SkyAtmosphereResources): ComputePass {
        if (this.device !== resources.device) {
            throw new Error(`[TransmittanceLutPipeline::makeComputePass]: device mismatch`);
        }
        if (resources.atmosphereBuffer.size < ATMOSPHERE_BUFFER_SIZE) {
            throw new Error(`[TransmittanceLutPipeline::makeComputePass]: buffer too small for atmosphere parameters (${resources.atmosphereBuffer.size} < ${ATMOSPHERE_BUFFER_SIZE})`);
        }
        if (resources.transmittanceLut.texture.format !== this.transmittanceLutFormat) {
            throw new Error(`[TransmittanceLutPipeline::makeComputePass]: wrong texture format for transmittance LUT. expected '${this.transmittanceLutFormat}', got ${resources.transmittanceLut.texture.format}`);
        }
        const bindGroup = resources.device.createBindGroup({
            label: `transmittance LUT pass [${resources.label}]`,
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
                    resource: resources.transmittanceLut.texture.createView(),
                },
            ],
        });
        return new ComputePass(
            this.pipeline,
            [bindGroup],
            [Math.ceil(resources.transmittanceLut.texture.width / 16.0), Math.ceil(resources.transmittanceLut.texture.height / 16.0), 1],
        );
    }
}

export class MultiScatteringLutPipeline {
    readonly device: GPUDevice;
    readonly pipeline: GPUComputePipeline;
    readonly bindGroupLayout: GPUBindGroupLayout;
    readonly multiScatteringLutFormat: GPUTextureFormat;

    constructor(device: GPUDevice, multiScatteringLutFormat: GPUTextureFormat, sampleCount: number) {
        this.device = device;
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
                    code: makeMultiScatteringLutShaderCode(multiScatteringLutFormat),
                }),
                entryPoint: 'render_multi_scattering_lut',
                constants: {
                    SAMPLE_COUNT: Math.max(sampleCount, MULTI_SCATTERING_LUT_MIN_SAMPLE_COUNT),
                },
            },
        });
    }

    public makeComputePass(resources: SkyAtmosphereResources): ComputePass {
        if (this.device !== resources.device) {
            throw new Error(`[MultiScatteringLutPipeline::makeComputePass]: device mismatch`);
        }
        if (resources.atmosphereBuffer.size < ATMOSPHERE_BUFFER_SIZE) {
            throw new Error(`[MultiScatteringLutPipeline::makeComputePass]: buffer too small for atmosphere parameters (${resources.atmosphereBuffer.size} < ${ATMOSPHERE_BUFFER_SIZE})`);
        }
        if (resources.multiScatteringLut.texture.format !== this.multiScatteringLutFormat) {
            throw new Error(`[MultiScatteringLutPipeline::makeComputePass]: wrong texture format for multiple scattering LUT. expected '${this.multiScatteringLutFormat}', got ${resources.multiScatteringLut.texture.format}`);
        }
        const bindGroup = resources.device.createBindGroup({
            label: `mulitple scattering LUT pass [${resources.label}]`,
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
                    resource: resources.transmittanceLut.view,
                },
                {
                    binding: 3,
                    resource: resources.multiScatteringLut.texture.createView(),
                },
            ],
        });
        return new ComputePass(
            this.pipeline,
            [bindGroup],
            [resources.multiScatteringLut.texture.width, resources.multiScatteringLut.texture.height, 1],
        );
    }
}

export class SkyViewLutPipeline {
    readonly device: GPUDevice;
    readonly pipeline: GPUComputePipeline;
    readonly bindGroupLayout: GPUBindGroupLayout;
    readonly skyViewLutFormat: GPUTextureFormat;
    readonly skyViewLutSize: [number, number];
    readonly multiscatteringLutSize: [number, number];

    constructor(device: GPUDevice, skyViewLutFormat: GPUTextureFormat, skyViewLutSize: [number, number], multiscatteringLutSize: [number, number], distanceToMaxSampleCount: number, useMoon: boolean, shadowConfig?: ShadowConfig) {
        this.device = device;
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
                bindGroupLayouts: [this.bindGroupLayout, ...(shadowConfig?.bindGroupLayouts ?? [])],
            }),
            compute: {
                module: device.createShaderModule({
                    code: `${shadowConfig?.wgslCode || 'fn get_shadow(p: vec3<f32>) -> f32 { return 1.0; }'}\n${makeSkyViewLutShaderCode(skyViewLutFormat)}`,
                }),
                entryPoint: 'render_sky_view_lut',
                constants: {
                    SKY_VIEW_LUT_RES_X: this.skyViewLutSize[0],
                    SKY_VIEW_LUT_RES_Y: this.skyViewLutSize[1],
                    INV_DISTANCE_TO_MAX_SAMPLE_COUNT: 1.0 / distanceToMaxSampleCount,
                    MULTI_SCATTERING_LUT_RES_X: this.multiscatteringLutSize[0],
                    MULTI_SCATTERING_LUT_RES_Y: this.multiscatteringLutSize[1],
                    USE_MOON: Number(useMoon),
                },
            },
        });
    }

    public makeComputePass(resources: SkyAtmosphereResources, shadowBindGroups?: GPUBindGroup[]): ComputePass {
        if (this.device !== resources.device) {
            throw new Error(`[SkyViewLutPipeline::makeComputePass]: device mismatch`);
        }
        if (resources.atmosphereBuffer.size < ATMOSPHERE_BUFFER_SIZE) {
            throw new Error(`[SkyViewLutPipeline::makeComputePass]: buffer too small for atmosphere parameters (${resources.uniformsBuffer.size} < ${UNIFORMS_BUFFER_SIZE})`);
        }
        if (resources.uniformsBuffer.size < UNIFORMS_BUFFER_SIZE) {
            throw new Error(`[SkyViewLutPipeline::makeComputePass]: buffer too small for config (${resources.atmosphereBuffer.size} < ${ATMOSPHERE_BUFFER_SIZE})`);
        }
        if (resources.multiScatteringLut.texture.width !== this.multiscatteringLutSize[0] || resources.multiScatteringLut.texture.height !== this.multiscatteringLutSize[1]) {
            throw new Error(`[SkyViewLutPipeline::makeComputePass]: wrong texture size for multiple scattering LUT. expected '${this.multiscatteringLutSize}', got ${[resources.multiScatteringLut.texture.width, resources.multiScatteringLut.texture.height]}`);
        }
        if (resources.skyViewLut.texture.format !== this.skyViewLutFormat) {
            throw new Error(`[SkyViewLutPipeline::makeComputePass]: wrong texture format for sky view LUT. expected '${this.skyViewLutFormat}', got ${resources.skyViewLut.texture.format}`);
        }
        if (resources.skyViewLut.texture.width !== this.skyViewLutSize[0] || resources.skyViewLut.texture.height !== this.skyViewLutSize[1]) {
            throw new Error(`[SkyViewLutPipeline::makeComputePass]: wrong texture size for sky view LUT. expected '${this.skyViewLutSize}', got ${[resources.skyViewLut.texture.width, resources.skyViewLut.texture.height]}`);
        }
        const bindGroup = resources.device.createBindGroup({
            label: `sky view LUT pass [${resources.label}]`,
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
                        buffer: resources.uniformsBuffer,
                    },
                },
                {
                    binding: 2,
                    resource: resources.lutSampler,
                },
                {
                    binding: 3,
                    resource: resources.transmittanceLut.view,
                },
                {
                    binding: 4,
                    resource: resources.multiScatteringLut.view,
                },
                {
                    binding: 5,
                    resource: resources.skyViewLut.texture.createView(),
                },
            ],
        });
        return new ComputePass(
            this.pipeline,
            [bindGroup, ...(shadowBindGroups ?? [])],
            [Math.ceil(resources.skyViewLut.texture.width / 16.0), Math.ceil(resources.skyViewLut.texture.height / 16.0), 1],
        );
    }
}

export class AerialPerspectiveLutPipeline {
    readonly device: GPUDevice;
    readonly pipeline: GPUComputePipeline;
    readonly bindGroupLayout: GPUBindGroupLayout;
    readonly aerialPerspectiveLutFormat: GPUTextureFormat;
    readonly aerialPerspectiveSliceCount: number;
    readonly aerialPerspectiveDistancePerSlice: number;
    readonly multiscatteringLutSize: [number, number];

    constructor(device: GPUDevice, aerialPerspectiveLutFormat: GPUTextureFormat, aerialPerspectiveSliceCount: number, aerialPerspectiveDistancePerSlice: number, multiscatteringLutSize: [number, number], useMoon: boolean, shadowConfig?: ShadowConfig) {
        this.device = device;
        this.aerialPerspectiveLutFormat = aerialPerspectiveLutFormat;
        this.aerialPerspectiveSliceCount = aerialPerspectiveSliceCount;
        this.aerialPerspectiveDistancePerSlice = aerialPerspectiveDistancePerSlice;
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
                bindGroupLayouts: [this.bindGroupLayout, ...(shadowConfig?.bindGroupLayouts ?? [])],
            }),
            compute: {
                module: device.createShaderModule({
                    code: `${shadowConfig?.wgslCode || 'fn get_shadow(p: vec3<f32>) -> f32 { return 1.0; }'}\n${makeAerialPerspectiveLutShaderCode(aerialPerspectiveLutFormat)}`,
                }),
                entryPoint: 'render_aerial_perspective_lut',
                constants: {
                    AP_SLICE_COUNT: this.aerialPerspectiveSliceCount,
                    AP_DISTANCE_PER_SLICE: this.aerialPerspectiveDistancePerSlice,
                    MULTI_SCATTERING_LUT_RES_X: this.multiscatteringLutSize[0],
                    MULTI_SCATTERING_LUT_RES_Y: this.multiscatteringLutSize[1],
                    USE_MOON: Number(useMoon),
                },
            },
        });
    }

    public makeComputePass(resources: SkyAtmosphereResources, shadowBindGroups?: GPUBindGroup[]): ComputePass {
        if (this.device !== resources.device) {
            throw new Error(`[AerialPerspectiveLutPipeline::makeComputePass]: device mismatch`);
        }
        if (resources.atmosphereBuffer.size < ATMOSPHERE_BUFFER_SIZE) {
            throw new Error(`[AerialPerspectiveLutPipeline::makeComputePass]: buffer too small for atmosphere parameters (${resources.uniformsBuffer.size} < ${UNIFORMS_BUFFER_SIZE})`);
        }
        if (resources.uniformsBuffer.size < UNIFORMS_BUFFER_SIZE) {
            throw new Error(`[AerialPerspectiveLutPipeline::makeComputePass]: buffer too small for config (${resources.atmosphereBuffer.size} < ${ATMOSPHERE_BUFFER_SIZE})`);
        }
        if (resources.multiScatteringLut.texture.width !== this.multiscatteringLutSize[0] || resources.multiScatteringLut.texture.height !== this.multiscatteringLutSize[1]) {
            throw new Error(`[AerialPerspectiveLutPipeline::makeComputePass]: wrong texture size for multiple scattering LUT. expected '${this.multiscatteringLutSize}', got ${[resources.multiScatteringLut.texture.width, resources.multiScatteringLut.texture.height]}`);
        }
        if (resources.aerialPerspectiveLut.texture.format !== this.aerialPerspectiveLutFormat) {
            throw new Error(`[AerialPerspectiveLutPipeline::makeComputePass]: wrong texture format for aerial perspective LUT. expected '${this.aerialPerspectiveLutFormat}', got ${resources.aerialPerspectiveLut.texture.format}`);
        }
        if (resources.aerialPerspectiveLut.texture.depthOrArrayLayers !== this.aerialPerspectiveSliceCount) {
            throw new Error(`[AerialPerspectiveLutPipeline::makeComputePass]: wrong texture depth for aerial perspective LUT. expected '${this.aerialPerspectiveSliceCount}', got ${resources.aerialPerspectiveLut.texture.depthOrArrayLayers}`);
        }
        const bindGroup = resources.device.createBindGroup({
            label: `aerial perspective LUT pass [${resources.label}]`,
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
                        buffer: resources.uniformsBuffer,
                    },
                },
                {
                    binding: 2,
                    resource: resources.lutSampler,
                },
                {
                    binding: 3,
                    resource: resources.transmittanceLut.view,
                },
                {
                    binding: 4,
                    resource: resources.multiScatteringLut.view,
                },
                {
                    binding: 5,
                    resource: resources.aerialPerspectiveLut.texture.createView(),
                },
            ],
        });
        return new ComputePass(
            this.pipeline,
            [bindGroup, ...(shadowBindGroups ?? [])],
            [
                Math.ceil(resources.aerialPerspectiveLut.texture.width / 16.0),
                Math.ceil(resources.aerialPerspectiveLut.texture.height / 16.0),
                resources.aerialPerspectiveLut.texture.depthOrArrayLayers,
            ],
        );
    }

    get aerialPerspectiveInvDistancePerSlice(): number {
        return 1.0 / this.aerialPerspectiveDistancePerSlice;
    }
}
