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
