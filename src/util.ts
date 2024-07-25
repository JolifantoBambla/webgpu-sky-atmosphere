/*
 * Copyright (c) 2024 Lukas Herzberger
 * SPDX-License-Identifier: MIT
 */

/**
 * A helper class for textures.
 */
export class LookUpTable {
    readonly texture: GPUTexture;
    readonly view: GPUTextureView;

    constructor(texture: GPUTexture) {
        this.texture = texture;
        this.view = texture.createView();
    }
}

/**
 * A helper class for compute passes
 */
export class ComputePass {
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
    replaceBindGroup(index: number, bindGroup: GPUBindGroup) {
        this.bindGroups[index] = bindGroup;
    }
    replaceDispatchDimensions(dispatchDimensions: [number, number, number]) {
        this.dispatchDimensions[0] = dispatchDimensions[0];
        this.dispatchDimensions[1] = dispatchDimensions[1];
        this.dispatchDimensions[2] = dispatchDimensions[2];
    }
}

/**
 * A helper class for render passes
 */
export class RenderPass {
    constructor(readonly pipeline: GPURenderPipeline, readonly bindGroups: GPUBindGroup[]) {}
    encode(passEncoder: GPURenderPassEncoder | GPURenderBundleEncoder, resetBindGroups: boolean = false, firstInstance: number = 0) {
        passEncoder.setPipeline(this.pipeline);
        for (let i = 0; i < this.bindGroups.length; ++i) {
            passEncoder.setBindGroup(i, this.bindGroups[i]);
        }
        passEncoder.draw(3, 1, 0, firstInstance);
        if (resetBindGroups) {
            for (let i = 0; i < this.bindGroups.length; ++i) {
                passEncoder.setBindGroup(i, null);
            }
        }
    }
    replaceBindGroup(index: number, bindGroup: GPUBindGroup) {
        this.bindGroups[index] = bindGroup;
    }
}

export function makeLutSampler(device: GPUDevice): GPUSampler {
    return device.createSampler({
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
