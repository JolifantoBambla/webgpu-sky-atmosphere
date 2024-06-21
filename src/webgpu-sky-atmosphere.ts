import testWgslCode from './test.wgsl';

import configWgsl from './shaders/common/config.wgsl';
import constantsWgsl from './shaders/common/constants.wgsl';
import intersectionWgsl from './shaders/common/intersection.wgsl';
import mediumWgsl from './shaders/common/medium.wgsl';
import phaseWgsl from './shaders/common/phase.wgsl';

import renderTransmittanceLutWgsl from './shaders/render_transmittance_lut.wgsl';

function makeTransmittanceLutShaderCode() {
    return `${constantsWgsl}\n${intersectionWgsl}\n${mediumWgsl}\n${renderTransmittanceLutWgsl}`;
}

const TRANSMITTANCE_LUT_FORMAT: GPUTextureFormat = 'rgba16float';
const MULTI_SCATTERING_LUT_FORMAT: GPUTextureFormat = TRANSMITTANCE_LUT_FORMAT;

const ATMOSPHERE_BUFFER_SIZE: number = 112;
const CONFIG_BUFFER_SIZE: number = 192;

export const DEFAULT_TRANSMITTANCE_LUT_SIZE: [number, number] = [256, 64];
export const DEFAULT_MULTISCATTERING_LUT_SIZE: number = 32;
export const DEFAULT_SKY_VIEW_LUT_SIZE: [number, number] = [192, 108];
export const DEFAULT_AERIAL_PERSPECTIVE_LUT_SIZE: [number, number, number] = [32, 32, 32];

export const DEFAULT_TRANSMITTANCE_LUT_SAMPLE_COUNT: number = 40;

export interface SkyAtmosphereLutConfig {
    /**
     * Defaults to [256, 64]
     */
    transmittanceLutSize?: [number, number],

    /**
     * Defaults to 40
     * Clamped to max(40, transmittanceLutSampleCount)
     */
    transmittanceLutSampleCount?: number,

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

export class Rayleigh {
	/** 
     * Rayleigh scattering exponential distribution scale in the atmosphere
     */
	public densityExpScale: number;
	/**
     * Rayleigh scattering coefficients (per kilometer)
     */
	public scattering: [number, number, number];

    constructor(densityExpScale: number, scattering: [number, number, number]) {
        this.densityExpScale = densityExpScale;
        this.scattering = scattering;
    }
}

export class Mie {
	/**
     * Mie scattering exponential distribution scale in the atmosphere
     */
	public densityExpScale: number;
	/**
     * Mie scattering coefficients (per kilometer)
     */
	public scattering: [number, number, number];
	/**
     * Mie extinction coefficients (per kilometer)
     */
	public extinction: [number, number, number];
	/**
     * Mie absorption coefficients (per kilometer)
     */
	//public absorption: [number, number, number];
	/**
     * Mie phase function excentricity
     */
	public phaseG: number;

    constructor(densityExpScale: number, scattering: [number, number, number], extinction: [number, number, number], phaseG: number) {
        this.densityExpScale = densityExpScale;
        this.scattering = scattering;
        this.extinction = extinction;
        this.phaseG = phaseG;
    }
}

export class AbsorptionLayer0 {
    /**
     * In kilometers
     */
    public width: number;
    public constantTerm: number;
    public linearTerm: number;

    constructor(width: number, constantTerm: number, linearTerm: number) {
        this.width = width;
        this.constantTerm = constantTerm;
        this.linearTerm = linearTerm;
    }
}

export class AbsorptionLayer1 {
    public constantTerm: number;
    public linearTerm: number;

    constructor(constantTerm: number, linearTerm: number) {
        this.constantTerm = constantTerm;
        this.linearTerm = linearTerm;
    }
}
    
/**
 * Another medium type in the atmosphere
 */
export class Absorption {
    public layer0: AbsorptionLayer0;
    public layer1: AbsorptionLayer1;
    /**
    * This other medium only absorb light, e.g. useful to represent ozone in the earth atmosphere (per kilometer)
    */
   public extinction: [number, number, number];

    constructor(layer0: AbsorptionLayer0, layer1: AbsorptionLayer1, extinction: [number, number, number]) {
        this.layer0 = layer0;
        this.layer1 = layer1;
        this.extinction = extinction;
    }
}

export class Atmosphere {
    /**
     * Radius of the planet in kilometers (center to ground)
     */ 
	public bottomRadius: number;
    /**
     * Height of atmosphere in kilometers (distance from {@link bottomRadius} to atmosphere top)
     * Clamped to max(height, 0)
     */
	public height: number;

    public rayleighComponent: Rayleigh;
    public mieComponent: Mie;
	public apsorptionComponent: Absorption;

	/**
     * The albedo of the ground.
     */
	public groundAlbedo: [number, number, number];

    constructor(bottomRadius: number, height: number, rayleighComponent: Rayleigh, mieComponent: Mie, absorptionComponent: Absorption, groundAlbedo: [number, number, number]) {
        this.bottomRadius = bottomRadius;
        this.height = Math.max(height, 0.0);
        this.rayleighComponent = rayleighComponent;
        this.mieComponent = mieComponent;
        this.apsorptionComponent = absorptionComponent;
        this.groundAlbedo = groundAlbedo;
    }

    // todo: interfaces are nicer I guess?
    public static earth(): Atmosphere {
        const rayleighScaleHeight = 8.0;
        const mieScaleHeight = 1.2;
        return new Atmosphere(
            6360.0,
            100.0,
            new Rayleigh(-1.0 / rayleighScaleHeight, [0.005802, 0.013558, 0.033100]),
            new Mie(-1.0 / mieScaleHeight, [0.003996, 0.003996, 0.003996], [0.004440, 0.004440, 0.004440], 0.8),
            new Absorption(
                new AbsorptionLayer0(25.0, -2.0 / 3.0, 1.0 / 15.0),
                new AbsorptionLayer1(8.0 / 3.0, -1.0 / 15.0),
                [0.000650, 0.001881, 0.000085],
            ),
            [0.0, 0.0, 0.0],
        );
    }
}


function atmosphereToFloatArray(atmosphere: Atmosphere) {
    return new Float32Array([
        atmosphere.rayleighComponent.scattering[0],
        atmosphere.rayleighComponent.scattering[1],
        atmosphere.rayleighComponent.scattering[2],
        atmosphere.rayleighComponent.densityExpScale,
        atmosphere.mieComponent.scattering[0],
        atmosphere.mieComponent.scattering[1],
        atmosphere.mieComponent.scattering[2],
        atmosphere.mieComponent.densityExpScale,
        atmosphere.mieComponent.extinction[0],
        atmosphere.mieComponent.extinction[1],
        atmosphere.mieComponent.extinction[2],
        atmosphere.mieComponent.phaseG,
        Math.max(atmosphere.mieComponent.extinction[0] - atmosphere.mieComponent.scattering[0], 0.0),
        Math.max(atmosphere.mieComponent.extinction[1] - atmosphere.mieComponent.scattering[1], 0.0),
        Math.max(atmosphere.mieComponent.extinction[2] - atmosphere.mieComponent.scattering[2], 0.0),
        atmosphere.apsorptionComponent.layer0.width,
        atmosphere.apsorptionComponent.layer0.constantTerm,
        atmosphere.apsorptionComponent.layer0.linearTerm,
        atmosphere.apsorptionComponent.layer1.constantTerm,
        atmosphere.apsorptionComponent.layer1.linearTerm,
        atmosphere.apsorptionComponent.extinction[0],
        atmosphere.apsorptionComponent.extinction[1],
        atmosphere.apsorptionComponent.extinction[2],
        atmosphere.bottomRadius,
        atmosphere.groundAlbedo[0],
        atmosphere.groundAlbedo[1],
        atmosphere.groundAlbedo[2],
        atmosphere.bottomRadius + atmosphere.height,
    ]);
}

export function foo(device: GPUDevice, lutConfig: SkyAtmosphereLutConfig = {transmittanceLutSize: DEFAULT_TRANSMITTANCE_LUT_SIZE,}): GPUTextureView {
    const transmittanceLut = device.createTexture({
        label: 'transmittance_lut',
        size: lutConfig.transmittanceLutSize || DEFAULT_TRANSMITTANCE_LUT_SIZE,
        format: TRANSMITTANCE_LUT_FORMAT,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });
    const transmittanceLutView = transmittanceLut.createView();

    const atmosphereBufferBindGroupLayout = device.createBindGroupLayout({
        label: 'Atmosphere buffer bind group layout',
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.COMPUTE,
                buffer: {
                    type: 'uniform',
                    hasDynamicOffset: false,
                    minBindingSize: ATMOSPHERE_BUFFER_SIZE,
                },
            },
        ],
    });

    const transmittanceLutOutputBindGroupLayout = device.createBindGroupLayout({
        label: 'Transmittance LUT Output BindGroup Layout',
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.COMPUTE,
                storageTexture: {
                    access: 'write-only',
                    format: transmittanceLut.format,
                    viewDimension: transmittanceLut.dimension,
                },
            },
        ],
    });

    const transmittanceLutPipeline = device.createComputePipeline({
        label: 'Transmittance LUT pipeline',
        layout: device.createPipelineLayout({
            label: 'Transmittance LUT pipeline layout',
            bindGroupLayouts: [
                atmosphereBufferBindGroupLayout,
                transmittanceLutOutputBindGroupLayout,
            ],
        }),
        compute: {
            module: device.createShaderModule({
                code: makeTransmittanceLutShaderCode(),
            }),
            entryPoint: 'render_transmittance_lut',
            constants: {
                SAMPLE_COUNT: lutConfig.transmittanceLutSampleCount || DEFAULT_TRANSMITTANCE_LUT_SAMPLE_COUNT,
            },
        },
    });

    // todo: use for later passes
    const uniformBufferBindGroupLayout = device.createBindGroupLayout({
        label: 'Sky atmosphere buffer bind group layout',
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.COMPUTE,
                buffer: {
                    type: 'uniform',
                    hasDynamicOffset: false,
                    minBindingSize: ATMOSPHERE_BUFFER_SIZE,
                },
            },
            {
                binding: 1,
                visibility: GPUShaderStage.COMPUTE,
                buffer: {
                    type: 'uniform',
                    hasDynamicOffset: false,
                    minBindingSize: CONFIG_BUFFER_SIZE,
                },
            },
        ],
    });

    const atmosphereBuffer = device.createBuffer({
        label: 'Atmosphere buffer',
        size: ATMOSPHERE_BUFFER_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(atmosphereBuffer, 0, new Float32Array(atmosphereToFloatArray(Atmosphere.earth())));

    const atmosphereBufferBindGroup = device.createBindGroup({
        label: 'Atmosphere buffer bind group',
        layout: atmosphereBufferBindGroupLayout,
        entries: [{
            binding: 0,
            resource: {
                buffer: atmosphereBuffer,
            },
        }],
    });

    const transmittanceLutOutputBindGroup = device.createBindGroup({
        label: 'Transmittance LUT Ouptut BindGroup',
        layout: transmittanceLutOutputBindGroupLayout,
        entries: [{
            binding: 0,
            resource: transmittanceLutView,
        }],
    });

    const commandEncoder = device.createCommandEncoder({
        label: 'Transmittance LUT command encoder',
    });
    const computePass = commandEncoder.beginComputePass({
        label: 'Transmittance LUT pass',
    });
    computePass.setPipeline(transmittanceLutPipeline);
    computePass.setBindGroup(0, atmosphereBufferBindGroup);
    computePass.setBindGroup(1, transmittanceLutOutputBindGroup);
    computePass.dispatchWorkgroups(Math.ceil(transmittanceLut.width / 16.0), Math.ceil(transmittanceLut.height / 16.0));
    computePass.end();

    device.queue.submit([commandEncoder.finish()]);

    console.log(transmittanceLutPipeline);

    return transmittanceLutView;
}
