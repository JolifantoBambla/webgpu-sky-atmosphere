/// <reference types="dist" />
import { SkyAtmosphereResources } from "./resources.js";
import { ComputePass } from "./util.js";
export declare const DEFAULT_TRANSMITTANCE_LUT_SAMPLE_COUNT: number;
export declare const DEFAULT_MULTI_SCATTERING_LUT_SAMPLE_COUNT: number;
export declare class SkyAtmospherePipelines {
    readonly lutSampler: GPUSampler;
    readonly transmittanceLutPipeline: TransmittanceLutPipeline;
    readonly multiScatteringLutPipeline: MultiScatteringLutPipeline;
    readonly skyViewLutPipeline: SkyViewLutPipeline;
    readonly aerialPerspectiveLutPipeline: AerialPerspectiveLutPipeline;
    constructor(device: GPUDevice);
}
export declare class TransmittanceLutPipeline {
    readonly device: GPUDevice;
    readonly pipeline: GPUComputePipeline;
    readonly bindGroupLayout: GPUBindGroupLayout;
    readonly transmittanceLutFormat: GPUTextureFormat;
    constructor(device: GPUDevice, transmittanceLutFormat?: GPUTextureFormat, sampleCount?: number);
    makeComputePass(resources: SkyAtmosphereResources): ComputePass;
}
export declare class MultiScatteringLutPipeline {
    readonly device: GPUDevice;
    readonly pipeline: GPUComputePipeline;
    readonly bindGroupLayout: GPUBindGroupLayout;
    readonly multiScatteringLutFormat: GPUTextureFormat;
    constructor(device: GPUDevice, multiScatteringLutFormat?: GPUTextureFormat, sampleCount?: number);
    makeComputePass(resources: SkyAtmosphereResources): ComputePass;
}
export declare class SkyViewLutPipeline {
    readonly device: GPUDevice;
    readonly pipeline: GPUComputePipeline;
    readonly bindGroupLayout: GPUBindGroupLayout;
    readonly skyViewLutFormat: GPUTextureFormat;
    readonly skyViewLutSize: [number, number];
    readonly multiscatteringLutSize: number;
    constructor(device: GPUDevice, skyViewLutFormat?: GPUTextureFormat, skyViewLutSize?: [number, number], multiscatteringLutSize?: number);
    makeComputePass(resources: SkyAtmosphereResources): ComputePass;
}
export declare class AerialPerspectiveLutPipeline {
    readonly device: GPUDevice;
    readonly pipeline: GPUComputePipeline;
    readonly bindGroupLayout: GPUBindGroupLayout;
    readonly aerialPerspectiveLutFormat: GPUTextureFormat;
    readonly multiscatteringLutSize: number;
    constructor(device: GPUDevice, aerialPerspectiveLutFormat?: GPUTextureFormat, multiscatteringLutSize?: number);
    makeComputePass(resources: SkyAtmosphereResources): ComputePass;
}
