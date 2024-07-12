export interface Rayleigh {
	/**
     * Rayleigh scattering exponential distribution scale in the atmosphere
     */
	densityExpScale: number,

    /**
     * Rayleigh scattering coefficients (per kilometer)
     */
	scattering: [number, number, number],
}

export interface Mie {
	/**
     * Mie scattering exponential distribution scale in the atmosphere
     */
	densityExpScale: number,

    /**
     * Mie scattering coefficients (per kilometer)
     */
	scattering: [number, number, number],

    /**
     * Mie extinction coefficients (per kilometer)
     */
	extinction: [number, number, number],

    /**
     * Mie phase function excentricity
     */
	phaseG: number,
}

export interface AbsorptionLayer0 {
    /**
     * In kilometers
     */
    width: number,
    constantTerm: number,
    linearTerm: number,
}

export interface AbsorptionLayer1 {
    constantTerm: number,
    linearTerm: number,
}

/**
 * Another medium type in the atmosphere
 */
export interface Absorption {
    layer0: AbsorptionLayer0,
    layer1: AbsorptionLayer1,

    /**
    * This other medium only absorb light, e.g. useful to represent ozone in the earth atmosphere (per kilometer)
    */
   extinction: [number, number, number],
}

export interface Atmosphere {
    /**
     * Center of the atmosphere.
     * 
     * For earth, this defaults to upDirection * -{@link bottomRadius}.
     */
    center: [number, number, number],

    /**
     * Radius of the planet in kilometers (center to ground)
     */
	bottomRadius: number,

    /**
     * Height of atmosphere in kilometers (distance from {@link bottomRadius} to atmosphere top)
     * Clamped to max(height, 0)
     */
	height: number,

    /**
     * Rayleigh component.
     */
    rayleigh: Rayleigh,

    /**
     * Mie component.
     */
    mie: Mie,

    /**
     * Absorption / Ozone component.
     */
	absorption: Absorption,

	/**
     * The albedo of the ground.
     */
	groundAlbedo: [number, number, number],

    /**
     * A weight for multiple scattering in the atmosphere.
     */
    multipleScatteringFactor: number,
}

/**
 * Create a default atmosphere that corresponds to earth's atmosphere.
 * @param center The center of the atmosphere.
 * @returns Atmosphere parameters corresponding to earth's atmosphere.
 */
export function makeEarthAtmosphere(center?: [number, number, number], yUp = true): Atmosphere {
    const rayleighScaleHeight = 8.0;
    const mieScaleHeight = 1.2;
    const bottomRadius = 6360.0;
    return {
        center: [0.0, yUp ? -bottomRadius : 0.0, yUp ? 0.0 : -bottomRadius],
        bottomRadius,
        height: 100.0,
        rayleigh: {
            densityExpScale: -1.0 / rayleighScaleHeight,
            scattering: [0.005802, 0.013558, 0.033100],
        },
        mie: {
            densityExpScale: -1.0 / mieScaleHeight,
            scattering: [0.003996, 0.003996, 0.003996],
            extinction: [0.004440, 0.004440, 0.004440],
            phaseG: 0.8,
        },
        absorption: {
            layer0: {
                width: 25.0,
                constantTerm: -2.0 / 3.0,
                linearTerm: 1.0 / 15.0,
            },
            layer1: {
                constantTerm: 8.0 / 3.0,
                linearTerm: -1.0 / 15.0,
            },
            extinction: [0.000650, 0.001881, 0.000085],
        },
        groundAlbedo: [0, 0, 0],//[0.4, 0.4, 0.4],
        multipleScatteringFactor: 1.0,
    };
}
