struct Config {
    // Inverse projection matrix for the current camera view
    inverse_projection: mat4x4<f32>,

    // Inverse view matrix for the current camera view
    inverse_view: mat4x4<f32>,

    // Illuminance of the sun
    sun_illuminance: vec3<f32>,

    // Minimum number of ray marching samples per pixel
    ray_march_min_spp: f32,

    // Direction to the sun (inverse sun light direction)
    sun_direction: vec3<f32>,

    // Maximum number of ray marching samples per pixel
    ray_march_max_spp: f32,

    // World position of the current camera view
    camera_world_position: vec3<f32>,

    // Resolution of the multiscattering LUT (width = height)
    frame_id: f32,

    // Resolution of the sky view LUT
    sky_view_lut_resoltion: vec2<f32>,

    // Resolution of the output texture
    screen_resolution: vec2<f32>,
}

// todo: use this instead

struct Uniforms {
    // Inverse projection matrix for the current camera view
    inverse_projection: mat4x4<f32>,

    // Inverse view matrix for the current camera view
    inverse_view: mat4x4<f32>,

    // World position of the current camera view
    camera_world_position: vec3<f32>,

    // Resolution of the multiscattering LUT (width = height)
    frame_id: f32,

    // Resolution of the output texture
    screen_resolution: vec2<f32>,

    // Minimum number of ray marching samples per pixel
    ray_march_min_spp: f32,

    // Maximum number of ray marching samples per pixel
    ray_march_max_spp: f32,
}

struct SkyLight {
    
    illuminance: vec3<f32>,
    
    diameter: f32,
    
    direction: vec3<f32>,
    pad1: f32,
    
    luminance: vec3<f32>,
    pad2: f32,
}
