export interface Camera {
    /**
     * World position of the current camera view
     */
    position: [number, number, number];
    /**
     * Inverse view matrix for the current camera view
     */
    inverseView: number[];
    /**
     * Inverse projection matrix for the current camera view
     */
    inverseProjection: number[];
}
/**
 * Properties of a directional light influencing the atmosphere (e.g., sun or moon).
 */
export interface AtmosphereLight {
    /**
     * Light's illuminance at the top of the atmosphere.
     *
     * Defaults to [1.0, 1.0, 1.0]
     */
    illuminance?: [number, number, number];
    /**
     * Light's direction (direction to the light source).
     *
     * This is expected to be normalized.
     */
    direction: [number, number, number];
    /**
     * Light disk's luminance scale.
     *
     * The light disk's luminance is computed from the given {@link illuminance} and the disk's {@link diskAngularDiameter}.
     * This scale is applied to the computed luminance value to give users more control over the sun disk's appearance.
     *
     * Defaults to 1.0.
     */
    diskLuminanceScale?: number;
    /**
     * Light disk's angular diameter in radians.
     *
     * For the sun, defaults to ~0.0095120444 (0.545 degrees)
     *
     * For the moon, defaults to ~0.0099134702 (0.568 degrees)
     */
    diskAngularDiameter?: number;
}
export interface Uniforms {
    /**
     * A directional light that influences the atmosphere.
     *
     * Defaults to the default sun.
     */
    sun: AtmosphereLight;
    /**
     * A directional lights that influences the atmosphere.
     *
     * Ignored if {@link SkyAtmosphereLutRenderer} is not configured to render the moon.
     */
    moon?: AtmosphereLight;
    /**
     * The current camera parameter.
     */
    camera: Camera;
    /**
     * Minimum number of ray marching samples per pixel when rendering the sky view lookup table or rendering the sky using per-pixel ray marching.
     *
     * Defaults to 14.
     */
    rayMarchMinSPP?: number;
    /**
     * Maximum number of ray marching samples per pixel when rendering the sky view lookup table or rendering the sky using per-pixel ray marching.
     *
     * Defaults to 30.
     */
    rayMarchMaxSPP?: number;
    /**
     * Resolution of the output texture.
     */
    screenResolution: [number, number];
    /**
     * The current frame id.
     *
     * This is only used if {@link FullResolutionRayMarchConfig.randomizeRayOffsets} or {@link AerialPerspectiveLutConfig.randomizeRayOffsets} is true.
     *
     * Defaults to 0.
     */
    frameId?: number;
}
