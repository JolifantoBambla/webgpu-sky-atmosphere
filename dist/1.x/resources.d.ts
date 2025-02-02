/// <reference types="dist" />
import { Atmosphere } from './atmosphere.js';
import { SkyAtmosphereRendererConfig } from './config.js';
import { Uniforms } from './uniforms.js';
import { LookUpTable } from './util.js';
export declare const DEFAULT_TRANSMITTANCE_LUT_SIZE: [number, number];
export declare const DEFAULT_MULTISCATTERING_LUT_SIZE: number;
export declare const DEFAULT_SKY_VIEW_LUT_SIZE: [number, number];
export declare const DEFAULT_AERIAL_PERSPECTIVE_LUT_SIZE: [number, number, number];
export declare const TRANSMITTANCE_LUT_FORMAT: GPUTextureFormat;
export declare const MULTI_SCATTERING_LUT_FORMAT: GPUTextureFormat;
export declare const SKY_VIEW_LUT_FORMAT: GPUTextureFormat;
export declare const AERIAL_PERSPECTIVE_LUT_FORMAT: GPUTextureFormat;
export declare const ATMOSPHERE_BUFFER_SIZE: number;
export declare const UNIFORMS_BUFFER_SIZE: number;
export declare class SkyAtmosphereResources {
    #private;
    /**
     * A name that is propagated to the WebGPU resources.
     */
    readonly label: string;
    /**
     * The WebGPU device the resources are allocated from.
     */
    readonly device: GPUDevice;
    /**
     * A uniform buffer of size {@link ATMOSPHERE_BUFFER_SIZE} storing the {@link Atmosphere}'s parameters.
     */
    readonly atmosphereBuffer: GPUBuffer;
    /**
     * A uniform buffer of size {@link UNIFORMS_BUFFER_SIZE} storing parameters set through {@link Uniforms}.
     *
     * If custom uniform buffers are used, this is undefined (see {@link CustomUniformsSourceConfig}).
     */
    readonly uniformsBuffer?: GPUBuffer;
    /**
     * A linear sampler used to sample the look up tables.
     */
    readonly lutSampler: GPUSampler;
    /**
     * The transmittance look up table.
     * Stores the medium transmittance toward the sun.
     *
     * Parameterized by the view / zenith angle in x and the altitude in y.
     */
    readonly transmittanceLut: LookUpTable;
    /**
     * The multiple scattering look up table.
     * Stores multiple scattering contribution.
     *
     * Paramterized by the sun / zenith angle in x (range: [π, 0]) and the altitude in y (range: [0, top], where top is the height of the atmosphere).
     */
    readonly multiScatteringLut: LookUpTable;
    /**
     * The sky view lookup table.
     * Stores the distant sky around the camera with respect to its altitude within the atmosphere.
     *
     * The lookup table is parameterized by a longitude mapping along the X-axis and a latitude mapping along the Y-axis.
     * The latitude range is always [-π/2, π/2], where 0 represents the horizon.
     * There are two supported longitude mappings:
     *  - **Default (Sun-centric)**: Longitude is mapped with respect to the sun direction, assuming symmetric contributions.
     *    This mapping uses a range of [0, π], where 0 is directly toward the sun and π is directly opposite.
     *    This mode is optimized for scenes with a single dominant light source.
     *  - **Uniform**: Longitude is uniformly mapped around the zenith with a full range of [0, 2π].
     *    This mode supports multiple light sources but comes at the cost of angular resolution.
     *
     * To enable the uniform longitude mapping, {@link SkyViewLutConfig.uniformParameterizationConfig} must be defined.
     * Note that this mapping assumes that light and view directions are given in a right-handed Y-up coordinate system. This is configured
     * by {@link SkyViewUniformParameterizationConfig.isYUp} and {@link SkyViewUniformParameterizationConfig.isRightHanded}.
     */
    readonly skyViewLut: LookUpTable;
    /**
     * The aerial perspective look up table.
     * Stores the aerial perspective in a volume fit to the view frustum.
     *
     * Parameterized by x and y corresponding to the image plane and z being the view depth (range: [0, {@link AerialPerspectiveLutConfig.size}[2] * {@link AerialPerspectiveLutConfig.distancePerSlice}]).
     */
    readonly aerialPerspectiveLut: LookUpTable;
    constructor(device: GPUDevice, config: SkyAtmosphereRendererConfig, lutSampler?: GPUSampler);
    get atmosphere(): Atmosphere;
    /**
     * Updates the {@link SkyAtmosphereResources.atmosphereBuffer} using a given {@link Atmosphere}.
     *
     * Overwrites this instance's internal {@link Atmosphere} parameters.
     *
     * @param atmosphere the {@link Atmosphere} to write to the {@link atmosphereBuffer}.
     * @see atmosphereToFloatArray Internally call {@link atmosphereToFloatArray} to convert the {@link Atmosphere} to a `Float32Array`.
     */
    updateAtmosphere(atmosphere: Atmosphere): void;
    /**
     * Updates the {@link SkyAtmosphereResources.uniformsBuffer} using a given {@link Uniforms}.
     * @param uniforms the {@link Uniforms} to write to the {@link atmosphereBuffer}.
     * @see uniformsToFloatArray Internally call {@link uniformsToFloatArray} to convert the {@link Uniforms} to a `Float32Array`.
     */
    updateUniforms(uniforms: Uniforms): void;
}
/**
 * Converts an {@link Atmosphere} to a tightly packed `Float32Array` of size {@link ATMOSPHERE_BUFFER_SIZE}.
 * @param atmosphere the {@link Atmosphere} to convert.
 * @returns a `Float32Array` containing the {@link Atmosphere} parameters.
 */
export declare function atmosphereToFloatArray(atmosphere: Atmosphere): Float32Array;
/**
 * Converts an {@link Uniforms} to a tightly packed `Float32Array` of size {@link UNIFORMS_BUFFER_SIZE}.
 * @param uniforms the {@link Uniforms} to convert.
 * @returns a `Float32Array` containing the {@link Uniforms} parameters.
 */
export declare function uniformsToFloatArray(uniforms: Uniforms): Float32Array;
