/// <reference types="dist" />
export declare function makeTransmittanceLutShaderCode(transmittanceLutFormat?: GPUTextureFormat): string;
export declare function makeMultiScatteringLutShaderCode(multiScatteringLutFormat?: GPUTextureFormat): string;
export declare function makeSkyViewLutShaderCode(skyViewLutFormat?: GPUTextureFormat, shadow?: string, customUniforms?: string, constDropletDiameter?: number): string;
export declare function makeAerialPerspectiveLutShaderCode(aerialPerspectiveLutFormat?: GPUTextureFormat, shadow?: string, customUniforms?: string, constDropletDiameter?: number): string;
export declare function makeRenderSkyWithLutsShaderCode(renderTargetFormat?: GPUTextureFormat, customUniforms?: string): string;
export declare function makeRenderSkyRaymarchingShaderCode(renderTargetFormat?: GPUTextureFormat, shadow?: string, customUniforms?: string, constDropletDiameter?: number): string;
export declare function makeRenderSkyLutAndRaymarchingShaderCode(renderTargetFormat?: GPUTextureFormat, shadow?: string, customUniforms?: string, constDropletDiameter?: number): string;
