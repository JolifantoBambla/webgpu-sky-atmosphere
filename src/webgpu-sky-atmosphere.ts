import testWgslCode from './test.wgsl';

export interface SkyAtmosphereLutConfig {
    /**
     * Defaults to [todo: look this up]
     */
    transmittanceLutSize?: [number, number],

    /**
     * Defaults to 32
     */
    multiScatteringLutSize?: number,

    /**
     * Defaults to [192, 108]
     */
    skyViewLutSize?: [number, number],

    /**
     * Defaults to [32, 32, 32]
     */
    aerialPerspectiveLutSize?: [number, number, number],
}

export class SkyAtmospherePasses {
    /*
    readonly transmittanceLut: GPUTexture;
    readonly multiScatteringLut: GPUTexture;
    readonly skyViewLut: GPUTexture;
    readonly aerialPerspectiveLut: GPUTexture;
    */
}

export function foo() {
    console.log(testWgslCode);
}
