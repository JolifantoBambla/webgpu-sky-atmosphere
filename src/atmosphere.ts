/**
 * Rayleigh scattering parameters.
 */
export interface Rayleigh {
	/**
     * Rayleigh scattering exponential distribution scale in the atmosphere in `u^-1`, where `u` is the distance unit used.
     */
	densityExpScale: number,

    /**
     * Rayleigh scattering coefficients in `u^-1`, where `u` is the distance unit used.
     */
	scattering: [number, number, number],
}

/**
 * Mie scattering parameters.
 *
 * The Mie phase function is approximated using the Cornette-Shanks phase function.
 */
export interface Mie {
	/**
     * Mie scattering exponential distribution scale in the atmosphere in `u^-1`, where `u` is the distance unit used.
     */
	densityExpScale: number,

    /**
     * Mie scattering coefficients in `u^-1`, where `u` is the distance unit used.
     */
	scattering: [number, number, number],

    /**
     * Mie extinction coefficients in `u^-1`, where `u` is the distance unit used.
     */
	extinction: [number, number, number],

    /**
     * Mie phase function excentricity, i.e., the asymmetry paraemter of the Cornette-Shanks phase function in range ]-1, 1[.
     */
	phaseG: number,
}

export interface AbsorptionLayer0 {
    /**
     * The height of the first layer of the absorption component in `u`, where `u` is the distance unit used.
     */
    height: number,

    /**
     * The constant term of the absorption component's first layer.
     *
     * This is unitless.
     */
    constantTerm: number,

    /**
     * The linear term of the absorption component's first layer in `u^-1`, where `u` is the distance unit used.
     */
    linearTerm: number,
}

export interface AbsorptionLayer1 {
    /**
     * The constant term of the absorption component's second layer.
     *
     * This is unitless.
     */
    constantTerm: number,

    /**
     * The linear term of the absorption component's second layer in `u^-1`, where `u` is the distance unit used.
     */
    linearTerm: number,
}

/**
 * A medium type in the atmosphere that only absorbs light with two layers.
 * In Earth's atmosphere this is used to model ozone.
 *
 * Computed as:
 *
 *      extinction * (linearTerm * h + constantTerm),
 *
 * where `h` is the altitude and `linearTerm` and `constantTerm` are the first or second layer's linear and constant terms.
 * If `h` is lower than {@link AbsorptionLayer0.height}, {@link Absorption.layer0} is used, otherwise {@link Absorption.layer1} is used.
 */
export interface Absorption {
    /**
     * The lower layer of the absorption component.
     */
    layer0: AbsorptionLayer0,

    /**
     * The upper layer of the absorption component.
     */
    layer1: AbsorptionLayer1,

    /**
    * The extinction coefficients of the absorption component in `u^-1`, where `u` is the distance unit used.
    */
   extinction: [number, number, number],
}

/**
 * Atmosphere parameters.
 *
 * The atmosphere is modelled as a sphere around a spherical planet.
 *
 * All parameters as well as the {@link AerialPerspectiveLutConfig.distancePerSlice} parameter are expected to be with respect to the same distance unit (e.g., kilometers).
 */
export interface Atmosphere {
    /**
     * Center of the atmosphere.
     */
    center: [number, number, number],

    /**
     * Radius of the planet (center to ground) in `u`, where `u` is the distance unit used.
     */
	bottomRadius: number,

    /**
     * Height of atmosphere (distance from {@link bottomRadius} to atmosphere top) in `u`, where `u` is the distance unit used.
     *
     * Clamped to `max(height, 0)`
     */
	height: number,

    /**
     * Rayleigh scattering component.
     */
    rayleigh: Rayleigh,

    /**
     * Mie scattering component.
     */
    mie: Mie,

    /**
     * Absorption / Ozone component.
     */
	absorption: Absorption,

	/**
     * The average albedo of the ground used to model light bounced off the planet's surface.
     */
	groundAlbedo: [number, number, number],

    /**
     * A weight for multiple scattering in the atmosphere.
     */
    multipleScatteringFactor: number,
}

/**
 * Create a default atmosphere that corresponds to earth's atmosphere.
 *
 * @param scale Scalar to scale all parameters by. Defaults to 1.0, corresponding to all parameters being in kilometers. If this is not 1.0, make sure to scale {@link AerialPerspectiveLutConfig.distancePerSlice} accordingly.
 * @param center The center of the atmosphere. Defaults to `upDirection * -{@link Atmosphere.bottomRadius}` (`upDirection` depends on `yUp`).
 * @param yUp If true, the up direction for the default center will be `[0, 1, 0]`, otherwise `[0, 0, 1]` will be used.
 *
 * @returns Atmosphere parameters corresponding to earth's atmosphere.
 */
export function makeEarthAtmosphere(scale = 1.0, center?: [number, number, number], yUp = true): Atmosphere {
    const rayleighScaleHeight = 8.0 * scale;
    const mieScaleHeight = 1.2 * scale;
    const bottomRadius = 6360.0 * scale;
    return {
        center: center ?? [0.0, yUp ? -bottomRadius : 0.0, yUp ? 0.0 : -bottomRadius],
        bottomRadius,
        height: 100.0 * scale,
        rayleigh: {
            densityExpScale: -1.0 / rayleighScaleHeight,
            scattering: [0.005802, 0.013558, 0.033100].map(c => c / scale) as [number, number, number],
        },
        mie: {
            densityExpScale: -1.0 / mieScaleHeight,
            scattering: [0.003996, 0.003996, 0.003996].map(c => c / scale) as [number, number, number],
            extinction: [0.004440, 0.004440, 0.004440].map(c => c / scale) as [number, number, number],
            phaseG: 0.8 * scale,
        },
        absorption: {
            layer0: {
                height: 25.0 * scale,
                constantTerm: -2.0 / 3.0,
                linearTerm: 1.0 / (15.0 * scale),
            },
            layer1: {
                constantTerm: 8.0 / 3.0,
                linearTerm: -1.0 / (15.0 * scale),
            },
            extinction: [0.000650, 0.001881, 0.000085].map(c => c / scale) as [number, number, number],
        },
        groundAlbedo: [0.4, 0.4, 0.4],
        multipleScatteringFactor: 1.0,
    };
}
