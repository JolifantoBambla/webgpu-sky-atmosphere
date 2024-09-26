/*
 * Copyright (c) 2024 Lukas Herzberger
 * SPDX-License-Identifier: MIT
 */

import { SkyAtmosphereRendererConfig, ShadowConfig, CustomUniformsSourceConfig, MieHgDPhaseConfig } from './config.js';
import { AERIAL_PERSPECTIVE_LUT_FORMAT, ATMOSPHERE_BUFFER_SIZE, UNIFORMS_BUFFER_SIZE, DEFAULT_AERIAL_PERSPECTIVE_LUT_SIZE, DEFAULT_MULTISCATTERING_LUT_SIZE, DEFAULT_SKY_VIEW_LUT_SIZE, MULTI_SCATTERING_LUT_FORMAT, SKY_VIEW_LUT_FORMAT, SkyAtmosphereResources, TRANSMITTANCE_LUT_FORMAT } from './resources.js';
import { makeAerialPerspectiveLutShaderCode, makeMultiScatteringLutShaderCode, makeSkyViewLutShaderCode, makeTransmittanceLutShaderCode } from './shaders.js';
import { ComputePass } from './util.js';

export const DEFAULT_TRANSMITTANCE_LUT_SAMPLE_COUNT: number = 40;
export const DEFAULT_MULTI_SCATTERING_LUT_SAMPLE_COUNT: number = 20;
export const MULTI_SCATTERING_LUT_MIN_SAMPLE_COUNT: number = 10;

export class TransmittanceLutPipeline {
    private constructor(
        readonly device: GPUDevice,
        readonly pipeline: GPUComputePipeline,
        readonly bindGroupLayout: GPUBindGroupLayout,
        readonly transmittanceLutFormat: GPUTextureFormat,
    ) {}

    private static makeBindGroupLayout(device: GPUDevice, transmittanceLutFormat: GPUTextureFormat): GPUBindGroupLayout {
        return device.createBindGroupLayout({
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
    }

    private static makePipelineDescriptor(device: GPUDevice, bindGroupLayout: GPUBindGroupLayout, transmittanceLutFormat: GPUTextureFormat, sampleCount: number): GPUComputePipelineDescriptor {
        return {
            label: 'transmittance LUT pass',
            layout: device.createPipelineLayout({
                label: 'transmittance LUT pass',
                bindGroupLayouts: [bindGroupLayout],
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
        };
    }

    static async createAsync(device: GPUDevice, transmittanceLutFormat: GPUTextureFormat, sampleCount: number): Promise<TransmittanceLutPipeline> {
        const bindGroupLayout = this.makeBindGroupLayout(device, transmittanceLutFormat);
        const pipeline = await device.createComputePipelineAsync(this.makePipelineDescriptor(device, bindGroupLayout, transmittanceLutFormat, sampleCount));
        return new TransmittanceLutPipeline(device, pipeline, bindGroupLayout, transmittanceLutFormat);
    }

    static create(device: GPUDevice, transmittanceLutFormat: GPUTextureFormat, sampleCount: number) {
        const bindGroupLayout = this.makeBindGroupLayout(device, transmittanceLutFormat);
        const pipeline = device.createComputePipeline(this.makePipelineDescriptor(device, bindGroupLayout, transmittanceLutFormat, sampleCount));
        return new TransmittanceLutPipeline(device, pipeline, bindGroupLayout, transmittanceLutFormat);
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
                    resource: resources.transmittanceLut.view,
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
    private constructor(
        readonly device: GPUDevice,
        readonly pipeline: GPUComputePipeline,
        readonly bindGroupLayout: GPUBindGroupLayout,
        readonly multiScatteringLutFormat: GPUTextureFormat,
    ) {}

    private static makeBindGroupLayout(device: GPUDevice, multiScatteringLutFormat: GPUTextureFormat): GPUBindGroupLayout {
        return device.createBindGroupLayout({
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
                        format: multiScatteringLutFormat,
                        viewDimension: '2d',
                    },
                },
            ],
        });
    }

    private static makePipelineDescriptor(device: GPUDevice, bindGroupLayout: GPUBindGroupLayout, multiScatteringLutFormat: GPUTextureFormat, sampleCount: number): GPUComputePipelineDescriptor {
        return {
            label: 'mulitple scattering LUT pass',
            layout: device.createPipelineLayout({
                label: 'mulitple scattering LUT pass',
                bindGroupLayouts: [bindGroupLayout],
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
        };
    }

    static async createAsync(device: GPUDevice, multiScatteringLutFormat: GPUTextureFormat, sampleCount: number): Promise<MultiScatteringLutPipeline> {
        const bindGroupLayout = this.makeBindGroupLayout(device, multiScatteringLutFormat);
        const pipeline = await device.createComputePipelineAsync(this.makePipelineDescriptor(device, bindGroupLayout, multiScatteringLutFormat, sampleCount));
        return new MultiScatteringLutPipeline(device, pipeline, bindGroupLayout, multiScatteringLutFormat);
    }

    static create(device: GPUDevice, multiScatteringLutFormat: GPUTextureFormat, sampleCount: number): MultiScatteringLutPipeline {
        const bindGroupLayout = this.makeBindGroupLayout(device, multiScatteringLutFormat);
        const pipeline = device.createComputePipeline(this.makePipelineDescriptor(device, bindGroupLayout, multiScatteringLutFormat, sampleCount));
        return new MultiScatteringLutPipeline(device, pipeline, bindGroupLayout, multiScatteringLutFormat);
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
                    resource: resources.multiScatteringLut.view,
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

export function makeMiePhaseOverrides(miePhaseConfig?: MieHgDPhaseConfig): Record<string, GPUPipelineConstantValue> {
    if (!miePhaseConfig) {
        return {};
    } else {
        const mieOverrides: Record<string, GPUPipelineConstantValue> = {
            MIE_USE_HG_DRAINE: Number(true),
        };
        if (!(miePhaseConfig.useConstantDropletDiameter ?? true)) {
            mieOverrides['MIE_USE_HG_DRAINE_DYNAMIC'] = Number(true);
        } else if (miePhaseConfig.constantDropletDiameter) {
            mieOverrides['HG_DRAINE_DROPLET_DIAMETER'] = miePhaseConfig.constantDropletDiameter;
        }
        return mieOverrides;
    }
}

export class SkyViewLutPipeline {
    private constructor(
        readonly device: GPUDevice,
        readonly pipeline: GPUComputePipeline,
        readonly bindGroupLayout: GPUBindGroupLayout,
        readonly skyViewLutFormat: GPUTextureFormat,
        readonly skyViewLutSize: [number, number],
        readonly multiscatteringLutSize: [number, number],
    ) {}

    private static makeBindGroupLayout(device: GPUDevice, skyViewLutFormat: GPUTextureFormat, customUniformsConfig?: CustomUniformsSourceConfig): GPUBindGroupLayout {
        return device.createBindGroupLayout({
            label: 'sky view LUT pass',
            entries: ([
                {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {
                        type: 'uniform',
                        hasDynamicOffset: false,
                        minBindingSize: ATMOSPHERE_BUFFER_SIZE,
                    },
                },
                customUniformsConfig ? undefined : {
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
                        format: skyViewLutFormat,
                        viewDimension: '2d',
                    },
                },
            ].filter(e => e !== undefined) as GPUBindGroupLayoutEntry[])
            .map((e, i) => {
                e.binding = i;
                return e;
            }) as GPUBindGroupLayoutEntry[],
        });
    }

    private static makePipelineDescriptor(device: GPUDevice, bindGroupLayout: GPUBindGroupLayout, skyViewLutFormat: GPUTextureFormat, skyViewLutSize: [number, number], multiscatteringLutSize: [number, number], distanceToMaxSampleCount: number, fromKilometersScaleFactor: number, useMoon: boolean, shadowConfig?: ShadowConfig, customUniformsConfig?: CustomUniformsSourceConfig, miePhaseConfig?: MieHgDPhaseConfig): GPUComputePipelineDescriptor {
        return {
            label: 'sky view LUT pass',
            layout: device.createPipelineLayout({
                label: 'sky view LUT pass',
                bindGroupLayouts: [bindGroupLayout, ...(shadowConfig?.bindGroupLayouts ?? []), ...(customUniformsConfig?.bindGroupLayouts ?? [])],
            }),
            compute: {
                module: device.createShaderModule({
                    label: 'sky view LUT',
                    code: makeSkyViewLutShaderCode(skyViewLutFormat, shadowConfig?.wgslCode, customUniformsConfig?.wgslCode, miePhaseConfig?.constantDropletDiameter),
                }),
                entryPoint: 'render_sky_view_lut',
                constants: {
                    SKY_VIEW_LUT_RES_X: skyViewLutSize[0],
                    SKY_VIEW_LUT_RES_Y: skyViewLutSize[1],
                    INV_DISTANCE_TO_MAX_SAMPLE_COUNT: 1.0 / distanceToMaxSampleCount,
                    MULTI_SCATTERING_LUT_RES_X: multiscatteringLutSize[0],
                    MULTI_SCATTERING_LUT_RES_Y: multiscatteringLutSize[1],
                    FROM_KM_SCALE: fromKilometersScaleFactor,
                    USE_MOON: Number(useMoon),
                    ...makeMiePhaseOverrides(miePhaseConfig),
                },
            },
        };
    }

    static async createAsync(device: GPUDevice, skyViewLutFormat: GPUTextureFormat, skyViewLutSize: [number, number], multiscatteringLutSize: [number, number], distanceToMaxSampleCount: number, fromKilometersScaleFactor: number, useMoon: boolean, shadowConfig?: ShadowConfig, customUniformsConfig?: CustomUniformsSourceConfig, miePhaseConfig?: MieHgDPhaseConfig): Promise<SkyViewLutPipeline> {
        const bindGroupLayout = this.makeBindGroupLayout(device, skyViewLutFormat, customUniformsConfig);
        const pipeline = await device.createComputePipelineAsync(this.makePipelineDescriptor(device, bindGroupLayout, skyViewLutFormat, skyViewLutSize, multiscatteringLutSize, distanceToMaxSampleCount, fromKilometersScaleFactor, useMoon, shadowConfig, customUniformsConfig, miePhaseConfig));
        return new SkyViewLutPipeline(device, pipeline, bindGroupLayout, skyViewLutFormat, skyViewLutSize, multiscatteringLutSize);
    }

    static create(device: GPUDevice, skyViewLutFormat: GPUTextureFormat, skyViewLutSize: [number, number], multiscatteringLutSize: [number, number], distanceToMaxSampleCount: number, fromKilometersScaleFactor: number, useMoon: boolean, shadowConfig?: ShadowConfig, customUniformsConfig?: CustomUniformsSourceConfig, miePhaseConfig?: MieHgDPhaseConfig): SkyViewLutPipeline {
        const bindGroupLayout = this.makeBindGroupLayout(device, skyViewLutFormat, customUniformsConfig);
        const pipeline = device.createComputePipeline(this.makePipelineDescriptor(device, bindGroupLayout, skyViewLutFormat, skyViewLutSize, multiscatteringLutSize, distanceToMaxSampleCount, fromKilometersScaleFactor, useMoon, shadowConfig, customUniformsConfig, miePhaseConfig));
        return new SkyViewLutPipeline(device, pipeline, bindGroupLayout, skyViewLutFormat, skyViewLutSize, multiscatteringLutSize);
    }

    public makeComputePass(resources: SkyAtmosphereResources, shadowBindGroups?: GPUBindGroup[], customUniformsBindGroups?: GPUBindGroup[]): ComputePass {
        if (this.device !== resources.device) {
            throw new Error(`[SkyViewLutPipeline::makeComputePass]: device mismatch`);
        }
        if (resources.atmosphereBuffer.size < ATMOSPHERE_BUFFER_SIZE) {
            throw new Error(`[SkyViewLutPipeline::makeComputePass]: buffer too small for atmosphere parameters (${resources.atmosphereBuffer.size} < ${ATMOSPHERE_BUFFER_SIZE})`);
        }
        if (resources.uniformsBuffer && resources.uniformsBuffer.size < UNIFORMS_BUFFER_SIZE) {
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
            entries: ([
                {
                    binding: 0,
                    resource: {
                        buffer: resources.atmosphereBuffer,
                    },
                },
                customUniformsBindGroups ? undefined : {
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
                    resource: resources.skyViewLut.view,
                },
            ].filter(e => e !== undefined) as GPUBindGroupEntry[])
            .map((e, i) => {
                e.binding = i;
                return e;
            }) as GPUBindGroupEntry[],
        });
        return new ComputePass(
            this.pipeline,
            [bindGroup, ...(shadowBindGroups ?? []), ...(customUniformsBindGroups ?? [])],
            [Math.ceil(resources.skyViewLut.texture.width / 16.0), Math.ceil(resources.skyViewLut.texture.height / 16.0), 1],
        );
    }
}

export class AerialPerspectiveLutPipeline {
    private constructor(
        readonly device: GPUDevice,
        readonly pipeline: GPUComputePipeline,
        readonly bindGroupLayout: GPUBindGroupLayout,
        readonly aerialPerspectiveLutFormat: GPUTextureFormat,
        readonly aerialPerspectiveSliceCount: number,
        readonly aerialPerspectiveDistancePerSlice: number,
        readonly multiscatteringLutSize: [number, number],
    ) {}

    private static makeBindGroupLayout(device: GPUDevice, aerialPerspectiveLutFormat: GPUTextureFormat, customUniformsConfig?: CustomUniformsSourceConfig): GPUBindGroupLayout {
        return device.createBindGroupLayout({
            label: 'aerial perspective LUT pass',
            entries: ([
                {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {
                        type: 'uniform',
                        hasDynamicOffset: false,
                        minBindingSize: ATMOSPHERE_BUFFER_SIZE,
                    },
                },
                customUniformsConfig ? undefined : {
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
                        format: aerialPerspectiveLutFormat,
                        viewDimension: '3d',
                    },
                },
            ].filter(e => e !== undefined) as GPUBindGroupLayoutEntry[])
            .map((e, i) => {
                e.binding = i;
                return e;
            }) as GPUBindGroupLayoutEntry[],
        });
    }

    private static makePipelineDescriptor(device: GPUDevice, bindGroupLayout: GPUBindGroupLayout, aerialPerspectiveLutFormat: GPUTextureFormat, aerialPerspectiveSliceCount: number, aerialPerspectiveDistancePerSlice: number, multiscatteringLutSize: [number, number], fromKilometersScaleFactor: number, randomizeSampleOffsets: boolean, useMoon: boolean, shadowConfig?: ShadowConfig, customUniformsConfig?: CustomUniformsSourceConfig, miePhaseConfig?: MieHgDPhaseConfig): GPUComputePipelineDescriptor {
        return {
            label: 'aerial perspective LUT pass',
            layout: device.createPipelineLayout({
                label: 'aerial perspective LUT pass',
                bindGroupLayouts: [bindGroupLayout, ...(shadowConfig?.bindGroupLayouts ?? []), ...(customUniformsConfig?.bindGroupLayouts ?? [])],
            }),
            compute: {
                module: device.createShaderModule({
                    label: 'aerial perspective LUT',
                    code: makeAerialPerspectiveLutShaderCode(aerialPerspectiveLutFormat, shadowConfig?.wgslCode, customUniformsConfig?.wgslCode, miePhaseConfig?.constantDropletDiameter),
                }),
                entryPoint: 'render_aerial_perspective_lut',
                constants: {
                    AP_SLICE_COUNT: aerialPerspectiveSliceCount,
                    AP_DISTANCE_PER_SLICE: aerialPerspectiveDistancePerSlice,
                    MULTI_SCATTERING_LUT_RES_X: multiscatteringLutSize[0],
                    MULTI_SCATTERING_LUT_RES_Y: multiscatteringLutSize[1],
                    FROM_KM_SCALE: fromKilometersScaleFactor,
                    RANDOMIZE_SAMPLE_OFFSET: Number(randomizeSampleOffsets),
                    USE_MOON: Number(useMoon),
                    ...makeMiePhaseOverrides(miePhaseConfig),
                },
            },
        };
    }

    static async createAsync(device: GPUDevice, aerialPerspectiveLutFormat: GPUTextureFormat, aerialPerspectiveSliceCount: number, aerialPerspectiveDistancePerSlice: number, multiscatteringLutSize: [number, number], fromKilometersScaleFactor: number, randomizeSampleOffsets: boolean, useMoon: boolean, shadowConfig?: ShadowConfig, customUniformsConfig?: CustomUniformsSourceConfig, miePhaseConfig?: MieHgDPhaseConfig): Promise<AerialPerspectiveLutPipeline> {
        const bindGroupLayout = this.makeBindGroupLayout(device, aerialPerspectiveLutFormat, customUniformsConfig);
        const pipeline = await device.createComputePipelineAsync(this.makePipelineDescriptor(device, bindGroupLayout, aerialPerspectiveLutFormat, aerialPerspectiveSliceCount, aerialPerspectiveDistancePerSlice, multiscatteringLutSize, fromKilometersScaleFactor, randomizeSampleOffsets, useMoon, shadowConfig, customUniformsConfig, miePhaseConfig));
        return new AerialPerspectiveLutPipeline(device, pipeline, bindGroupLayout, aerialPerspectiveLutFormat, aerialPerspectiveSliceCount, aerialPerspectiveDistancePerSlice, multiscatteringLutSize);
    }

    static create(device: GPUDevice, aerialPerspectiveLutFormat: GPUTextureFormat, aerialPerspectiveSliceCount: number, aerialPerspectiveDistancePerSlice: number, multiscatteringLutSize: [number, number], fromKilometersScaleFactor: number, randomizeSampleOffsets: boolean, useMoon: boolean, shadowConfig?: ShadowConfig, customUniformsConfig?: CustomUniformsSourceConfig, miePhaseConfig?: MieHgDPhaseConfig): AerialPerspectiveLutPipeline {
        const bindGroupLayout = this.makeBindGroupLayout(device, aerialPerspectiveLutFormat, customUniformsConfig);
        const pipeline = device.createComputePipeline(this.makePipelineDescriptor(device, bindGroupLayout, aerialPerspectiveLutFormat, aerialPerspectiveSliceCount, aerialPerspectiveDistancePerSlice, multiscatteringLutSize, fromKilometersScaleFactor, randomizeSampleOffsets, useMoon, shadowConfig, customUniformsConfig, miePhaseConfig));
        return new AerialPerspectiveLutPipeline(device, pipeline, bindGroupLayout, aerialPerspectiveLutFormat, aerialPerspectiveSliceCount, aerialPerspectiveDistancePerSlice, multiscatteringLutSize);
    }

    public makeComputePass(resources: SkyAtmosphereResources, shadowBindGroups?: GPUBindGroup[], customUniformsBindGroups?: GPUBindGroup[]): ComputePass {
        if (this.device !== resources.device) {
            throw new Error(`[AerialPerspectiveLutPipeline::makeComputePass]: device mismatch`);
        }
        if (resources.atmosphereBuffer.size < ATMOSPHERE_BUFFER_SIZE) {
            throw new Error(`[AerialPerspectiveLutPipeline::makeComputePass]: buffer too small for atmosphere parameters (${resources.atmosphereBuffer.size} < ${ATMOSPHERE_BUFFER_SIZE})`);
        }
        if (resources.uniformsBuffer && resources.uniformsBuffer.size < UNIFORMS_BUFFER_SIZE) {
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
            entries: ([
                {
                    binding: 0,
                    resource: {
                        buffer: resources.atmosphereBuffer,
                    },
                },
                customUniformsBindGroups ? undefined : {
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
                    resource: resources.aerialPerspectiveLut.view,
                },
            ].filter(e => e !== undefined) as GPUBindGroupEntry[])
            .map((e, i) => {
                e.binding = i;
                return e;
            }) as GPUBindGroupEntry[],
        });
        return new ComputePass(
            this.pipeline,
            [bindGroup, ...(shadowBindGroups ?? []), ...(customUniformsBindGroups ?? [])],
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

export class SkyAtmospherePipelines {
    private constructor(
        readonly transmittanceLutPipeline: TransmittanceLutPipeline,
        readonly multiScatteringLutPipeline: MultiScatteringLutPipeline,
        readonly skyViewLutPipeline: SkyViewLutPipeline,
        readonly aerialPerspectiveLutPipeline: AerialPerspectiveLutPipeline,
    ) {}

    private static getTransmittanceLutArgs(config: SkyAtmosphereRendererConfig): [GPUTextureFormat, number] {
        return [
            config.lookUpTables?.transmittanceLut?.format ?? TRANSMITTANCE_LUT_FORMAT,
            config.lookUpTables?.transmittanceLut?.sampleCount ?? DEFAULT_TRANSMITTANCE_LUT_SAMPLE_COUNT,
        ];
    }

    private static getMultiScatteringLutArgs(config: SkyAtmosphereRendererConfig): [GPUTextureFormat, number] {
        return [
            config.lookUpTables?.multiScatteringLut?.format ?? MULTI_SCATTERING_LUT_FORMAT,
            config.lookUpTables?.multiScatteringLut?.sampleCount ?? DEFAULT_MULTI_SCATTERING_LUT_SAMPLE_COUNT,
        ];
    }

    private static getSkyViewLutArgs(config: SkyAtmosphereRendererConfig): [GPUTextureFormat, [number, number], [number, number], number, number, boolean, ShadowConfig | undefined, CustomUniformsSourceConfig | undefined, MieHgDPhaseConfig | undefined] {
        return [
            config.lookUpTables?.skyViewLut?.format ?? SKY_VIEW_LUT_FORMAT,
            config.lookUpTables?.skyViewLut?.size ?? DEFAULT_SKY_VIEW_LUT_SIZE,
            config.lookUpTables?.multiScatteringLut?.size ?? [DEFAULT_MULTISCATTERING_LUT_SIZE, DEFAULT_MULTISCATTERING_LUT_SIZE],
            config.skyRenderer?.distanceToMaxSampleCount ?? 100.0,
            config.fromKilometersScale ?? 1.0,
            config.lights?.useMoon ?? false,
            (config.lookUpTables?.skyViewLut?.affectedByShadow ?? true) ? config.shadow : undefined,
            config.customUniformsSource,
            config.mieHgDrainePhase,
        ];
    }

    private static getAerialPerspectiveLutArgs(config: SkyAtmosphereRendererConfig): [GPUTextureFormat, number, number, [number, number], number, boolean, boolean, ShadowConfig | undefined, CustomUniformsSourceConfig | undefined, MieHgDPhaseConfig | undefined] {
        return [
            config.lookUpTables?.aerialPerspectiveLut?.format ?? AERIAL_PERSPECTIVE_LUT_FORMAT,
            (config.lookUpTables?.aerialPerspectiveLut?.size ?? DEFAULT_AERIAL_PERSPECTIVE_LUT_SIZE)[2],
            config.lookUpTables?.aerialPerspectiveLut?.distancePerSlice ?? 4.0,
            config.lookUpTables?.multiScatteringLut?.size ?? [DEFAULT_MULTISCATTERING_LUT_SIZE, DEFAULT_MULTISCATTERING_LUT_SIZE],
            config.fromKilometersScale ?? 1.0,
            config.lookUpTables?.aerialPerspectiveLut?.randomizeRayOffsets ?? false,
            config.lights?.useMoon ?? false,
            (config.lookUpTables?.aerialPerspectiveLut?.affectedByShadow ?? true) ? config.shadow : undefined,
            config.customUniformsSource,
            config.mieHgDrainePhase,
        ];
    }

    static async createAsync(device: GPUDevice, config: SkyAtmosphereRendererConfig): Promise<SkyAtmospherePipelines> {
        const transmittanceLutArgs = this.getTransmittanceLutArgs(config);
        const multiScatteringLutArgs = this.getMultiScatteringLutArgs(config);
        const skyViewLutArgs = this.getSkyViewLutArgs(config);
        const aerialPerspectiveLutArgs = this.getAerialPerspectiveLutArgs(config);

        const transmittanceLutPipeline = TransmittanceLutPipeline.createAsync(device,
            transmittanceLutArgs[0],
            transmittanceLutArgs[1],
        );
        const multiScatteringLutPipeline = MultiScatteringLutPipeline.createAsync(
            device,
            multiScatteringLutArgs[0],
            multiScatteringLutArgs[1],
        );
        const skyViewLutPipeline = SkyViewLutPipeline.createAsync(
            device,
            skyViewLutArgs[0],
            skyViewLutArgs[1],
            skyViewLutArgs[2],
            skyViewLutArgs[3],
            skyViewLutArgs[4],
            skyViewLutArgs[5],
            skyViewLutArgs[6],
            skyViewLutArgs[7],
            skyViewLutArgs[8],
        );
        const aerialPerspectiveLutPipeline = AerialPerspectiveLutPipeline.createAsync(
            device,
            aerialPerspectiveLutArgs[0],
            aerialPerspectiveLutArgs[1],
            aerialPerspectiveLutArgs[2],
            aerialPerspectiveLutArgs[3],
            aerialPerspectiveLutArgs[4],
            aerialPerspectiveLutArgs[5],
            aerialPerspectiveLutArgs[6],
            aerialPerspectiveLutArgs[7],
            aerialPerspectiveLutArgs[8],
            aerialPerspectiveLutArgs[9],
        );
        return new SkyAtmospherePipelines(
            await transmittanceLutPipeline,
            await multiScatteringLutPipeline,
            await skyViewLutPipeline,
            await aerialPerspectiveLutPipeline,
        );
    }

    static create(device: GPUDevice, config: SkyAtmosphereRendererConfig): SkyAtmospherePipelines {
        const transmittanceLutArgs = this.getTransmittanceLutArgs(config);
        const multiScatteringLutArgs = this.getMultiScatteringLutArgs(config);
        const skyViewLutArgs = this.getSkyViewLutArgs(config);
        const aerialPerspectiveLutArgs = this.getAerialPerspectiveLutArgs(config);

        const transmittanceLutPipeline = TransmittanceLutPipeline.create(device,
            transmittanceLutArgs[0],
            transmittanceLutArgs[1],
        );
        const multiScatteringLutPipeline = MultiScatteringLutPipeline.create(
            device,
            multiScatteringLutArgs[0],
            multiScatteringLutArgs[1],
        );
        const skyViewLutPipeline = SkyViewLutPipeline.create(
            device,
            skyViewLutArgs[0],
            skyViewLutArgs[1],
            skyViewLutArgs[2],
            skyViewLutArgs[3],
            skyViewLutArgs[4],
            skyViewLutArgs[5],
            skyViewLutArgs[6],
            skyViewLutArgs[7],
            skyViewLutArgs[8],
        );
        const aerialPerspectiveLutPipeline = AerialPerspectiveLutPipeline.create(
            device,
            aerialPerspectiveLutArgs[0],
            aerialPerspectiveLutArgs[1],
            aerialPerspectiveLutArgs[2],
            aerialPerspectiveLutArgs[3],
            aerialPerspectiveLutArgs[4],
            aerialPerspectiveLutArgs[5],
            aerialPerspectiveLutArgs[6],
            aerialPerspectiveLutArgs[7],
            aerialPerspectiveLutArgs[8],
            aerialPerspectiveLutArgs[9],
        );
        return new SkyAtmospherePipelines(
            transmittanceLutPipeline,
            multiScatteringLutPipeline,
            skyViewLutPipeline,
            aerialPerspectiveLutPipeline,
        );
    }
}
