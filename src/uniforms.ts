export interface Camera {
    /**
     * World position of the current camera view
     */
    position: [number, number, number],

    /**
     * Inverse view matrix for the current camera view
     */
    inverseView: number[],

    /**
     * Inverse projection matrix for the current camera view
     */
    inverseProjection: number[],
}

/**
 * Properties of a directional light influencing the atmosphere (e.g., sun or moon).
 */
export interface AtmosphereLight {
    /**
     * Light's illuminance.
     *
     * Defaults to [1.0, 1.0, 1.0]
     */
    illuminance?: [number, number, number],

    /**
     * Light's direction (direction to the light source).
     *
     * This is expected to be normalized.
     */
    direction: [number, number, number],

    /**
     * Light disk's luminance.
     *
     * For the sun, defaults to 120000.0
     *
     * For the moon, defaults to 0.26
     */
    luminance?: number,

    /**
     * Light disk's angular diameter in radians.
     *
     * For the sun, defaults to ~0.0095120444 (0.545 degrees)
     *
     * For the moon, defaults to ~0.0099134702 (0.568 degrees)
     */
    diameter?: number,
}

export interface Uniforms {
    /**
     * A directional light that influences the atmosphere.
     *
     * Defaults to the default sun.
     *
     * Ignored if custom light sources are used.
     */
    sun: AtmosphereLight,

    /**
     * A directional lights that influences the atmosphere.
     *
     * Ignored if {@link SkyAtmosphereRenderer} is not configured to render 2 atmosphere lights.
     * Ignored if custom light sources are used.
     */
    moon?: AtmosphereLight,

    /**
     * The current camera parameter.
     */
    camera: Camera,

    /**
     * Minimum number of ray marching samples per pixel
     */
    rayMarchMinSPP: number,

    /**
     * Maximum number of ray marching samples per pixel
     */
    rayMarchMaxSPP: number,

    /**
     * Resolution of the output texture.
     */
    screenResolution: [number, number],

    /**
     * The current frame id.
     */
    frameId: number,
}
