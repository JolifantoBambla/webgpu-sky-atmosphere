export class LookUpTable {
    readonly texture: GPUTexture;
    readonly view: GPUTextureView;

    constructor(texture: GPUTexture) {
        this.texture = texture;
        this.view = texture.createView();
    }
}

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
}

export class RenderPass {
    constructor(readonly pipeline: GPURenderPipeline, readonly bindGroups: GPUBindGroup[]) {}
    encode(passEncoder: GPURenderPassEncoder | GPURenderBundleEncoder, resetBindGroups: boolean = false) {
        passEncoder.setPipeline(this.pipeline);
        for (let i = 0; i < this.bindGroups.length; ++i) {
            passEncoder.setBindGroup(i, this.bindGroups[i]);
        }
        passEncoder.draw(3);
        if (resetBindGroups) {
            for (let i = 0; i < this.bindGroups.length; ++i) {
                passEncoder.setBindGroup(i, null);
            }
        }
    }
}
