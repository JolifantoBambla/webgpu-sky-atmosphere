import { Atmosphere, makeEarthAtmosphere } from "./atmosphere.js";
import { SkyAtmosphereConfig } from "./config.js";
import { Uniforms } from "./uniforms.js";
import { LookUpTable } from "./util.js";

export const DEFAULT_TRANSMITTANCE_LUT_SIZE: [number, number] = [256, 64];
export const DEFAULT_MULTISCATTERING_LUT_SIZE: number = 32;
export const DEFAULT_SKY_VIEW_LUT_SIZE: [number, number] = [192, 108];
export const DEFAULT_AERIAL_PERSPECTIVE_LUT_SIZE: [number, number, number] = [32, 32, 32];

export const TRANSMITTANCE_LUT_FORMAT: GPUTextureFormat = 'rgba16float';
export const MULTI_SCATTERING_LUT_FORMAT: GPUTextureFormat = TRANSMITTANCE_LUT_FORMAT;
export const SKY_VIEW_LUT_FORMAT: GPUTextureFormat = TRANSMITTANCE_LUT_FORMAT;
export const AERIAL_PERSPECTIVE_LUT_FORMAT: GPUTextureFormat = TRANSMITTANCE_LUT_FORMAT;

export const ATMOSPHERE_BUFFER_SIZE: number = 128;
export const CONFIG_BUFFER_SIZE: number = 192;

export class SkyAtmosphereResources {
    readonly label: string;

    readonly device: GPUDevice;

    readonly atmosphereBuffer: GPUBuffer;
    readonly configBuffer: GPUBuffer;

    readonly lutSampler: GPUSampler;

    readonly transmittanceLut: LookUpTable;
    readonly multiScatteringLut: LookUpTable;
    readonly skyViewLut: LookUpTable;
    readonly aerialPerspectiveLut: LookUpTable;

    readonly config: SkyAtmosphereConfig;

    constructor(device: GPUDevice, config: SkyAtmosphereConfig, lutSampler?: GPUSampler) {
        this.label = config.label ?? 'atmosphere';
        this.device = device;
        this.config = config;

        this.atmosphereBuffer = device.createBuffer({
            label: `atmosphere buffer [${this.label}]`,
            size: ATMOSPHERE_BUFFER_SIZE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.updateAtmosphere(config.atmosphere ?? makeEarthAtmosphere());

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
            size: config.lookUpTables?.transmittanceLutSize ?? DEFAULT_TRANSMITTANCE_LUT_SIZE, // todo: validate / clamp
            format: TRANSMITTANCE_LUT_FORMAT,
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
        }));

        this.multiScatteringLut = new LookUpTable(device.createTexture({
            label: `multi scattering LUT [${this.label}]`,
            size: new Array(2).fill(config.lookUpTables?.multiScatteringLutSize ?? DEFAULT_MULTISCATTERING_LUT_SIZE), // todo: validate / clamp
            format: MULTI_SCATTERING_LUT_FORMAT,
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
        }));

        this.skyViewLut = new LookUpTable(device.createTexture({
            label: `sky view LUT [${this.label}]`,
            size: config.lookUpTables?.skyViewLutSize ?? DEFAULT_SKY_VIEW_LUT_SIZE, // todo: validate / clamp
            format: SKY_VIEW_LUT_FORMAT,
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
        }));

        this.aerialPerspectiveLut = new LookUpTable(device.createTexture({
            label: `aerial perspective LUT [${this.label}]`,
            size: config.lookUpTables?.aerialPerspectiveLutSize ?? DEFAULT_AERIAL_PERSPECTIVE_LUT_SIZE, // todo: validate / clamp
            format: AERIAL_PERSPECTIVE_LUT_FORMAT,
            dimension: '3d',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
        }));
    }

    public updateAtmosphere(atmosphere: Atmosphere) {
        this.device.queue.writeBuffer(this.atmosphereBuffer, 0, new Float32Array(atmosphereToFloatArray(atmosphere, this.config.coordinateSystem?.yUp ?? true)));
    }

    public updateConfig(config: Uniforms) {
        this.device.queue.writeBuffer(this.configBuffer, 0, new Float32Array(configToFloatArray(config)));
    }
}

function atmosphereToFloatArray(atmosphere: Atmosphere, yUp = true) {
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
        atmosphere.absorption.layer0.width,
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
        ...(atmosphere.center ?? [0.0, yUp ? -atmosphere.bottomRadius : 0.0, yUp ? 0.0 : -atmosphere.bottomRadius]),
        0.0, // padding
    ]);
}

function configToFloatArray(config: Uniforms) {
    return new Float32Array([
        ...config.camera.inverseProjection,
        ...config.camera.inverseView,
        ...config.sun.illuminance,
        config.rayMarchMinSPP,
        ...config.sun.direction,
        config.rayMarchMaxSPP,
        ...config.camera.position,
        config.frameId,
        ...DEFAULT_SKY_VIEW_LUT_SIZE,
        ...config.screenResolution,
    ]);
}

