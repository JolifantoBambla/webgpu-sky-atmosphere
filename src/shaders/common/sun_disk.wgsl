// todo: add sun disk config to params
override RENDER_SUN_DISK: bool = true;

fn get_sun_luminance(world_pos: vec3<f32>, world_dir: vec3<f32>, planet_radius: f32) -> vec3<f32> {
    if RENDER_SUN_DISK {
        if !ray_intersects_sphere(world_pos, world_dir, vec3<f32>(), planet_radius) { // no intersection
            for (var light_index = 0u; light_index < arrayLength(&sky_lights); light_index += 1) {
                if dot(world_dir, to_z_up(normalize(sky_lights[light_index].direction))) > cos(0.5 * sky_lights[light_index].diameter) {
                    return sky_lights[light_index].luminance;
                }   
            }
        }
    }
	return vec3<f32>();
}
