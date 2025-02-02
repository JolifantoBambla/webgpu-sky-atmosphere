/// <reference types="dist" />
import { SkyAtmosphereRendererConfig, ShadowConfig, CustomUniformsSourceConfig, MieHgDPhaseConfig, SkyViewUniformParameterizationConfig } from './config.js';
import { SkyAtmosphereResources } from './resources.js';
import { ComputePass } from './util.js';
export declare const DEFAULT_TRANSMITTANCE_LUT_SAMPLE_COUNT: number;
export declare const DEFAULT_MULTI_SCATTERING_LUT_SAMPLE_COUNT: number;
export declare const MULTI_SCATTERING_LUT_MIN_SAMPLE_COUNT: number;
export declare class TransmittanceLutPipeline {
    readonly device: GPUDevice;
    readonly pipeline: GPUComputePipeline;
    readonly bindGroupLayout: GPUBindGroupLayout;
    readonly transmittanceLutFormat: GPUTextureFormat;
    private constructor();
    private static makeBindGroupLayout;
    private static makePipelineDescriptor;
    static createAsync(device: GPUDevice, transmittanceLutFormat: GPUTextureFormat, sampleCount: number): Promise<TransmittanceLutPipeline>;
    static create(device: GPUDevice, transmittanceLutFormat: GPUTextureFormat, sampleCount: number): TransmittanceLutPipeline;
    makeComputePass(resources: SkyAtmosphereResources): ComputePass;
}
export declare class MultiScatteringLutPipeline {
    readonly device: GPUDevice;
    readonly pipeline: GPUComputePipeline;
    readonly bindGroupLayout: GPUBindGroupLayout;
    readonly multiScatteringLutFormat: GPUTextureFormat;
    private constructor();
    private static makeBindGroupLayout;
    private static makePipelineDescriptor;
    static createAsync(device: GPUDevice, multiScatteringLutFormat: GPUTextureFormat, sampleCount: number): Promise<MultiScatteringLutPipeline>;
    static create(device: GPUDevice, multiScatteringLutFormat: GPUTextureFormat, sampleCount: number): MultiScatteringLutPipeline;
    makeComputePass(resources: SkyAtmosphereResources): ComputePass;
}
export declare function makeMiePhaseOverrides(miePhaseConfig?: MieHgDPhaseConfig): Record<string, GPUPipelineConstantValue>;
export declare function makeSkyViewUniformParameterizationOverrides(uniformParameterizationConfig?: SkyViewUniformParameterizationConfig): Record<string, GPUPipelineConstantValue>;
export declare class SkyViewLutPipeline {
    readonly device: GPUDevice;
    readonly pipeline: GPUComputePipeline;
    readonly bindGroupLayout: GPUBindGroupLayout;
    readonly skyViewLutFormat: GPUTextureFormat;
    readonly skyViewLutSize: [number, number];
    readonly multiscatteringLutSize: [number, number];
    private constructor();
    private static makeBindGroupLayout;
    private static makePipelineDescriptor;
    static createAsync(device: GPUDevice, skyViewLutFormat: GPUTextureFormat, skyViewLutSize: [number, number], multiscatteringLutSize: [number, number], distanceToMaxSampleCount: number, fromKilometersScaleFactor: number, useMoon: boolean, uniformParameterizationConfig?: SkyViewUniformParameterizationConfig, shadowConfig?: ShadowConfig, customUniformsConfig?: CustomUniformsSourceConfig, miePhaseConfig?: MieHgDPhaseConfig): Promise<SkyViewLutPipeline>;
    static create(device: GPUDevice, skyViewLutFormat: GPUTextureFormat, skyViewLutSize: [number, number], multiscatteringLutSize: [number, number], distanceToMaxSampleCount: number, fromKilometersScaleFactor: number, useMoon: boolean, uniformParameterizationConfig?: SkyViewUniformParameterizationConfig, shadowConfig?: ShadowConfig, customUniformsConfig?: CustomUniformsSourceConfig, miePhaseConfig?: MieHgDPhaseConfig): SkyViewLutPipeline;
    makeComputePass(resources: SkyAtmosphereResources, shadowBindGroups?: GPUBindGroup[], customUniformsBindGroups?: GPUBindGroup[]): ComputePass;
}
export declare class AerialPerspectiveLutPipeline {
    readonly device: GPUDevice;
    readonly pipeline: GPUComputePipeline;
    readonly bindGroupLayout: GPUBindGroupLayout;
    readonly aerialPerspectiveLutFormat: GPUTextureFormat;
    readonly aerialPerspectiveSliceCount: number;
    readonly aerialPerspectiveDistancePerSlice: number;
    readonly multiscatteringLutSize: [number, number];
    private constructor();
    private static makeBindGroupLayout;
    private static makePipelineDescriptor;
    static createAsync(device: GPUDevice, aerialPerspectiveLutFormat: GPUTextureFormat, aerialPerspectiveSliceCount: number, aerialPerspectiveDistancePerSlice: number, multiscatteringLutSize: [number, number], fromKilometersScaleFactor: number, randomizeSampleOffsets: boolean, useMoon: boolean, shadowConfig?: ShadowConfig, customUniformsConfig?: CustomUniformsSourceConfig, miePhaseConfig?: MieHgDPhaseConfig): Promise<AerialPerspectiveLutPipeline>;
    static create(device: GPUDevice, aerialPerspectiveLutFormat: GPUTextureFormat, aerialPerspectiveSliceCount: number, aerialPerspectiveDistancePerSlice: number, multiscatteringLutSize: [number, number], fromKilometersScaleFactor: number, randomizeSampleOffsets: boolean, useMoon: boolean, shadowConfig?: ShadowConfig, customUniformsConfig?: CustomUniformsSourceConfig, miePhaseConfig?: MieHgDPhaseConfig): AerialPerspectiveLutPipeline;
    makeComputePass(resources: SkyAtmosphereResources, shadowBindGroups?: GPUBindGroup[], customUniformsBindGroups?: GPUBindGroup[]): ComputePass;
    get aerialPerspectiveInvDistancePerSlice(): number;
}
export declare class SkyAtmospherePipelines {
    readonly transmittanceLutPipeline: TransmittanceLutPipeline;
    readonly multiScatteringLutPipeline: MultiScatteringLutPipeline;
    readonly skyViewLutPipeline: SkyViewLutPipeline;
    readonly aerialPerspectiveLutPipeline: AerialPerspectiveLutPipeline;
    private constructor();
    private static getTransmittanceLutArgs;
    private static getMultiScatteringLutArgs;
    private static getSkyViewLutArgs;
    private static getAerialPerspectiveLutArgs;
    static createAsync(device: GPUDevice, config: SkyAtmosphereRendererConfig): Promise<SkyAtmospherePipelines>;
    static create(device: GPUDevice, config: SkyAtmosphereRendererConfig): SkyAtmospherePipelines;
}
