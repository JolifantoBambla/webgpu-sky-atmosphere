// todo: add sun disk config to params
override RENDER_SUN_DISK: bool = true;

fn get_sun_luminance(world_pos: vec3<f32>, world_dir: vec3<f32>, sun_dir: vec3<f32>, planet_radius: f32) -> vec3<f32> {
    if RENDER_SUN_DISK {
        // todo: get rid of of this hard coded value
        if dot(world_dir, sun_dir) > cos(0.5 * 0.505 * 3.14159 / 180.0) {
            if !ray_intersects_sphere(world_pos, world_dir, vec3<f32>(), planet_radius) { // no intersection
                // todo: get rid of of this hard coded value
                return vec3<f32>(1000000.0);
            }
        }
	}
	return vec3<f32>();
}
