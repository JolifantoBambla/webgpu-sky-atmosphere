/*
 * Copyright (c) 2024 Lukas Herzberger
 * SPDX-License-Identifier: MIT
 */

fn get_uniforms() -> Uniforms {
	Uniforms uniforms;
	uniforms.inverse_projection = get_inverse_projection();
	uniforms.inverse_view = get_inverse_view();
	uniforms.camera_world_position = get_camera_world_position();
	uniforms.frame_id = get_frame_id();
	uniforms.screen_resolution = get_screen_resolution();
	uniforms.ray_march_min_spp = get_ray_march_min_spp();
	uniforms.ray_march_max_spp = get_ray_march_max_spp();
	uniforms.sun.illuminance = get_sun_illuminance();
	uniforms.sun.direction = get_sun_direction();
	uniforms.sun.disk_diameter =  get_sun_disk_diameter();
	uniforms.sun.disk_luminance_scale = get_sun_disk_luminance_scale();
	uniforms.moon.illuminance = get_moon_illuminance();
	uniforms.moon.direction = get_moon_direction();
	uniforms.moon.disk_diameter =  get_moon_disk_diameter();
	uniforms.moon.disk_luminance_scale = get_moon_disk_luminance_scale();
	return uniforms;
}
