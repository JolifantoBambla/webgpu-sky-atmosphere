import { Atmosphere, makeEarthAtmosphere } from './atmosphere.js';
import { SkyAtmosphereConfig } from './config.js';
import { Uniforms } from './uniforms.js';
import { LookUpTable } from './util.js';

export const DEFAULT_TRANSMITTANCE_LUT_SIZE: [number, number] = [256, 64];
export const DEFAULT_MULTISCATTERING_LUT_SIZE: number = 32;
export const DEFAULT_SKY_VIEW_LUT_SIZE: [number, number] = [192, 108];
export const DEFAULT_AERIAL_PERSPECTIVE_LUT_SIZE: [number, number, number] = [32, 32, 32];

export const TRANSMITTANCE_LUT_FORMAT: GPUTextureFormat = 'rgba16float';
export const MULTI_SCATTERING_LUT_FORMAT: GPUTextureFormat = TRANSMITTANCE_LUT_FORMAT;
export const SKY_VIEW_LUT_FORMAT: GPUTextureFormat = TRANSMITTANCE_LUT_FORMAT;
export const AERIAL_PERSPECTIVE_LUT_FORMAT: GPUTextureFormat = TRANSMITTANCE_LUT_FORMAT;

export const ATMOSPHERE_BUFFER_SIZE: number = 128;
export const CONFIG_BUFFER_SIZE: number = 224;

export class SkyAtmosphereResources {
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
     * A uniform buffer of size {@link CONFIG_BUFFER_SIZE} storing parameters set through {@link Uniforms}.
     */
    readonly configBuffer: GPUBuffer;

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
     * The sky view look up table.
     * Stores the distant sky around the camera with respect to it's altitude within the atmosphere.
     *
     * Parameterized by the longitude in x (range: [0, 2π]) and latitude in y (range: [-π/2, π/2]).
     */
    readonly skyViewLut: LookUpTable;

    /**
     * The aerial perspective look up table.
     * Stores the aerial perspective in a volume fit to the view frustum.
     *
     * Parameterized by x and y corresponding to the image plane and z being the view depth (range: [0, {@link AerialPerspectiveLutConfig.size}[2] * {@link AerialPerspectiveLutConfig.distancePerSlice}]).
     */
    readonly aerialPerspectiveLut: LookUpTable;

    constructor(device: GPUDevice, config: SkyAtmosphereConfig, lutSampler?: GPUSampler) {
        this.label = config.label ?? 'atmosphere';
        this.device = device;

        this.atmosphereBuffer = device.createBuffer({
            label: `atmosphere buffer [${this.label}]`,
            size: ATMOSPHERE_BUFFER_SIZE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.updateAtmosphere(config.atmosphere ?? makeEarthAtmosphere(config.distanceScaleFactor ?? 1.0));

        this.configBuffer = device.createBuffer({
            label: `config buffer [${this.label}]`,
            size: CONFIG_BUFFER_SIZE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.lutSampler = lutSampler || device.createSampler({
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

        this.transmittanceLut = new LookUpTable(device.createTexture({
            label: `transmittance LUT [${this.label}]`,
            size: config.lookUpTables?.transmittanceLut?.size ?? DEFAULT_TRANSMITTANCE_LUT_SIZE,
            format: config.lookUpTables?.transmittanceLut?.format ?? TRANSMITTANCE_LUT_FORMAT,
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
        }));

        this.multiScatteringLut = new LookUpTable(device.createTexture({
            label: `multi scattering LUT [${this.label}]`,
            size: config.lookUpTables?.multiScatteringLut?.size ?? [DEFAULT_MULTISCATTERING_LUT_SIZE, DEFAULT_MULTISCATTERING_LUT_SIZE],
            format: config.lookUpTables?.multiScatteringLut?.format ?? MULTI_SCATTERING_LUT_FORMAT,
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
        }));

        this.skyViewLut = new LookUpTable(device.createTexture({
            label: `sky view LUT [${this.label}]`,
            size: config.lookUpTables?.skyViewLut?.size ?? DEFAULT_SKY_VIEW_LUT_SIZE,
            format: config.lookUpTables?.skyViewLut?.format ?? SKY_VIEW_LUT_FORMAT,
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
        }));

        this.aerialPerspectiveLut = new LookUpTable(device.createTexture({
            label: `aerial perspective LUT [${this.label}]`,
            size: config.lookUpTables?.aerialPerspectiveLut?.size ?? DEFAULT_AERIAL_PERSPECTIVE_LUT_SIZE,
            format: config.lookUpTables?.aerialPerspectiveLut?.format ?? AERIAL_PERSPECTIVE_LUT_FORMAT,
            dimension: '3d',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
        }));
    }

    /**
     * Updates the {@link SkyAtmosphereResources.atmosphereBuffer} using a given {@link Atmosphere}.
     * @param atmosphere the {@link Atmosphere} to write to the {@link atmosphereBuffer}.
     * @see atmosphereToFloatArray Internally call {@link atmosphereToFloatArray} to convert the {@link Atmosphere} to a `Float32Array`.
     */
    public updateAtmosphere(atmosphere: Atmosphere) {
        this.device.queue.writeBuffer(this.atmosphereBuffer, 0, atmosphereToFloatArray(atmosphere));
    }

    /**
     * Updates the {@link SkyAtmosphereResources.configBuffer} using a given {@link Uniforms}.
     * @param config the {@link Uniforms} to write to the {@link atmosphereBuffer}.
     * @see configToFloatArray Internally call {@link configToFloatArray} to convert the {@link Uniforms} to a `Float32Array`.
     */
    public updateConfig(config: Uniforms) {
        this.device.queue.writeBuffer(this.configBuffer, 0, configToFloatArray(config));
    }
}

/**
 * Converts an {@link Atmosphere} to a tightly packed `Float32Array`.
 * @param atmosphere the {@link Atmosphere} to convert.
 * @returns a `Float32Array` containing the {@link Atmosphere} parameters.
 */
export function atmosphereToFloatArray(atmosphere: Atmosphere): Float32Array {
    return new Float32Array([
        atmosphere.rayleigh.scattering[0],
        atmosphere.rayleigh.scattering[1],
        atmosphere.rayleigh.scattering[2],
        atmosphere.rayleigh.densityExpScale,
        atmosphere.mie.scattering[0],
        atmosphere.mie.scattering[1],
        atmosphere.mie.scattering[2],
        atmosphere.mie.densityExpScale,
        atmosphere.mie.extinction[0],
        atmosphere.mie.extinction[1],
        atmosphere.mie.extinction[2],
        atmosphere.mie.phaseG,
        Math.max(atmosphere.mie.extinction[0] - atmosphere.mie.scattering[0], 0.0),
        Math.max(atmosphere.mie.extinction[1] - atmosphere.mie.scattering[1], 0.0),
        Math.max(atmosphere.mie.extinction[2] - atmosphere.mie.scattering[2], 0.0),
        atmosphere.absorption.layer0.height,
        atmosphere.absorption.layer0.constantTerm,
        atmosphere.absorption.layer0.linearTerm,
        atmosphere.absorption.layer1.constantTerm,
        atmosphere.absorption.layer1.linearTerm,
        atmosphere.absorption.extinction[0],
        atmosphere.absorption.extinction[1],
        atmosphere.absorption.extinction[2],
        atmosphere.bottomRadius,
        atmosphere.groundAlbedo[0],
        atmosphere.groundAlbedo[1],
        atmosphere.groundAlbedo[2],
        atmosphere.bottomRadius + Math.max(atmosphere.height, 0.0),
        ...atmosphere.center,
        atmosphere.multipleScatteringFactor,
    ]);
}

/**
 * Converts an {@link Uniforms} to a tightly packed `Float32Array`.
 * @param config the {@link Uniforms} to convert.
 * @returns a `Float32Array` containing the {@link Uniforms} parameters.
 */
export function configToFloatArray(config: Uniforms): Float32Array {
    return new Float32Array([
        ...config.camera.inverseProjection,
        ...config.camera.inverseView,
        ...config.camera.position,
        config.frameId,
        ...config.screenResolution,
        config.rayMarchMinSPP,
        config.rayMarchMaxSPP,
        ...(config.sun.illuminance ?? [1.0, 1.0, 1.0]),
        config.sun.diameter ?? (0.545 * (Math.PI / 180.0)),
        ...config.sun.direction,
        config.sun.luminance ?? 120000.0,
        ...(config.moon?.illuminance ?? [1.0, 1.0, 1.0]),
        config.moon?.diameter ?? (0.568 * Math.PI / 180.0),
        ...(config.moon?.direction ?? config.sun.direction.map(d => d * -1)),
        config.moon?.luminance ?? 0.26,
    ]);
}

