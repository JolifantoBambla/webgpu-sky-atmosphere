/*
 * Copyright (c) 2024 Lukas Herzberger
 * Copyright (c) 2020 Epic Games, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Rayleigh scattering parameters.
 */
export interface Rayleigh {
	/**
     * Rayleigh scattering exponential distribution scale in the atmosphere in `km^-1`.
     */
	densityExpScale: number,

    /**
     * Rayleigh scattering coefficients in `km^-1`.
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
     * Mie scattering exponential distribution scale in the atmosphere in `km^-1`.
     */
	densityExpScale: number,

    /**
     * Mie scattering coefficients in `km^-1`.
     */
	scattering: [number, number, number],

    /**
     * Mie extinction coefficients in `km^-1`.
     */
	extinction: [number, number, number],

    /**
     * Mie phase function parameter.
     *
     * For Cornette-Shanks, this is the excentricity, i.e., the asymmetry paraemter of the phase function in range ]-1, 1[.
     *
     * For Henyey-Greenstein + Draine, this is the droplet diameter in µm. This should be in range ]2, 20[ (according to the paper, the lower bound for plausible fog particle sizes is 5 µm).
     * For Henyey-Greenstein + Draine using a constant droplet diameter, this parameter has no effect.
     */
	phaseParam: number,
}

export interface AbsorptionLayer0 {
    /**
     * The height of the first layer of the absorption component in kilometers.
     */
    height: number,

    /**
     * The constant term of the absorption component's first layer.
     *
     * This is unitless.
     */
    constantTerm: number,

    /**
     * The linear term of the absorption component's first layer in `km^-1`.
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
     * The linear term of the absorption component's second layer in `km^-1`.
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
    * The extinction coefficients of the absorption component in `km^-1`.
    */
   extinction: [number, number, number],
}

/**
 * Atmosphere parameters.
 *
 * The atmosphere is modelled as a sphere around a spherical planet.
 */
export interface Atmosphere {
    /**
     * Center of the atmosphere.
     */
    center: [number, number, number],

    /**
     * Radius of the planet (center to ground) in kilometers.
     */
	bottomRadius: number,

    /**
     * Height of atmosphere (distance from {@link bottomRadius} to atmosphere top) in kilometers.
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
 * @param center The center of the atmosphere. Defaults to `upDirection * -{@link Atmosphere.bottomRadius}` (`upDirection` depends on `yUp`).
 * @param yUp If true, the up direction for the default center will be `[0, 1, 0]`, otherwise `[0, 0, 1]` will be used.
 * @param useHenyeyGreenstein If this is true, {@link Mie.phaseParam} will be set to a value suitable for the Cornette-Shanks approximation (`0.8`), otherwise it is set to `3.4` for use with the Henyey-Greenstein + Draine approximation.
 *
 * @returns Atmosphere parameters corresponding to earth's atmosphere.
 */
export function makeEarthAtmosphere(center?: [number, number, number], yUp = true, useHenyeyGreenstein = true): Atmosphere {
    const rayleighScaleHeight = 8.0;
    const mieScaleHeight = 1.2;
    const bottomRadius = 6360.0;
    return {
        center: center ?? [0.0, yUp ? -bottomRadius : 0.0, yUp ? 0.0 : -bottomRadius],
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
            phaseParam: useHenyeyGreenstein ? 0.8 : 3.4,
        },
        absorption: {
            layer0: {
                height: 25.0,
                constantTerm: -2.0 / 3.0,
                linearTerm: 1.0 / 15.0,
            },
            layer1: {
                constantTerm: 8.0 / 3.0,
                linearTerm: -1.0 / 15.0,
            },
            extinction: [0.000650, 0.001881, 0.000085],
        },
        groundAlbedo: [0.4, 0.4, 0.4],
        multipleScatteringFactor: 1.0,
    };
}
