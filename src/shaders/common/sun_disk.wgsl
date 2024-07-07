override RENDER_SUN_DISK: bool = true;
override RENDER_MOON_DISK: bool = true;

fn get_sun_luminance(world_pos: vec3<f32>, world_dir: vec3<f32>, planet_radius: f32) -> vec3<f32> {
    let sun_disk = RENDER_SUN_DISK && dot(world_dir, config_buffer.sun.direction) > cos(0.5 * config_buffer.sun.disk_diameter);
    let moon_disk = RENDER_MOON_DISK && USE_MOON && dot(world_dir, config_buffer.moon.direction) > cos(0.5 * config_buffer.moon.disk_diameter);
    if (sun_disk || moon_disk) && !ray_intersects_sphere(world_pos, world_dir, vec3<f32>(), planet_radius) {
        return vec3<f32>(config_buffer.sun.disk_luminance * f32(sun_disk) + config_buffer.moon.disk_luminance * f32(moon_disk));
    }
	return vec3<f32>();
}
