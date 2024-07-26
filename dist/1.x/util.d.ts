/// <reference types="dist" />
/**
 * A helper class for textures.
 */
export declare class LookUpTable {
    readonly texture: GPUTexture;
    readonly view: GPUTextureView;
    constructor(texture: GPUTexture);
}
/**
 * A helper class for compute passes
 */
export declare class ComputePass {
    readonly pipeline: GPUComputePipeline;
    readonly bindGroups: GPUBindGroup[];
    readonly dispatchDimensions: [number, number, number];
    constructor(pipeline: GPUComputePipeline, bindGroups: GPUBindGroup[], dispatchDimensions: [number, number, number]);
    encode(computePassEncoder: GPUComputePassEncoder, resetBindGroups?: boolean): void;
    replaceBindGroup(index: number, bindGroup: GPUBindGroup): void;
    replaceDispatchDimensions(dispatchDimensions: [number, number, number]): void;
}
/**
 * A helper class for render passes
 */
export declare class RenderPass {
    readonly pipeline: GPURenderPipeline;
    readonly bindGroups: GPUBindGroup[];
    constructor(pipeline: GPURenderPipeline, bindGroups: GPUBindGroup[]);
    encode(passEncoder: GPURenderPassEncoder | GPURenderBundleEncoder, resetBindGroups?: boolean): void;
    replaceBindGroup(index: number, bindGroup: GPUBindGroup): void;
}
export declare function makeLutSampler(device: GPUDevice): GPUSampler;
