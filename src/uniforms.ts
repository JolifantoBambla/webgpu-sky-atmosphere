export interface Camera {
    // World position of the current camera view
    position: [number, number, number],

    // Inverse view matrix for the current camera view
    inverseView: number[],

    // Inverse projection matrix for the current camera view
    inverseProjection: number[],
}

export interface Sun {
    // Illuminance of the sun
    illuminance: [number, number, number],

    // Direction to the sun (inverse sun light direction)
    direction: [number, number, number],
}

export interface Uniforms {
    // todo: should allow for more suns? or at least sun+moon?
    sun: Sun,
    camera: Camera,

    // Minimum number of ray marching samples per pixel
    rayMarchMinSPP: number,

    // Maximum number of ray marching samples per pixel
    rayMarchMaxSPP: number,

    // Resolution of the output texture
    screenResolution: [number, number],
}
