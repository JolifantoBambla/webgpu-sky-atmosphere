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

export interface Config {
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

export function makeDefaultConfig(): Config {
    return {
        camera: {
            position: [0.0, 1.0, 0.0],
            inverseView: Array(16).fill(0.0),
            inverseProjection: Array(16).fill(0.0),
        },
        sun: {
            illuminance: [1.0, 1.0, 1.0],
            direction: [0.0, 1.0, 0.0],
        },
        screenResolution: [1920, 1080],
        rayMarchMinSPP: 30,
        rayMarchMaxSPP: 31,
    };
}
