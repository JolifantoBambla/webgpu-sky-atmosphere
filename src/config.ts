export class Camera {
    // World position of the current camera view
    public position: [number, number, number];

    // Inverse view matrix for the current camera view
    public inverseView: number[];

    // Inverse projection matrix for the current camera view
    public inverseProjection: number[];

    constructor(position: [number, number, number], inverseView: number[], inverseProjection: number[]) {
        this.position = position;
        this.inverseView = inverseView;
        this.inverseProjection = inverseProjection;
    }
}

export class Sun {
    // Illuminance of the sun
    public illuminance: [number, number, number];

    // Direction to the sun (inverse sun light direction)
    public direction: [number, number, number];

    constructor(illuminance: [number, number, number], direction: [number, number, number]) {
        this.illuminance = illuminance;
        this.direction = direction;
    }
}

export class Config {
    public sun: Sun;
    public camera: Camera;

    // Minimum number of ray marching samples per pixel
    public rayMarchMinSPP: number;

    // Maximum number of ray marching samples per pixel
    public rayMarchMaxSPP: number;

    // Resolution of the output texture
    public screenResolution: [number, number];

    // todo: interface?
    // todo: actually set these
    constructor() {
        this.camera = new Camera(
            [0.0, 1.0, 0.0],
            // todo: set these from outside, include math lib in demo but not in lib
            Array(16).fill(0.0),
            Array(16).fill(0.0),
        );
        this.sun = new Sun([1.0, 1.0, 1.0], [0.0, 1.0, 0.0]);
        this.screenResolution = [1920, 1080];
        this.rayMarchMinSPP = 30;
        this.rayMarchMaxSPP = 31;
    }
}
