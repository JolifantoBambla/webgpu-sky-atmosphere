/*
 * Copyright (c) 2024 Lukas Herzberger
 * Copyright (c) 2020 Epic Games, Inc.
 * SPDX-License-Identifier: MIT
 */

override SAMPLE_COUNT: u32 = 40;

override WORKGROUP_SIZE_X: u32 = 16;
override WORKGROUP_SIZE_Y: u32 = 16;

@group(0) @binding(0) var<uniform> atmosphere_buffer: Atmosphere;
@group(0) @binding(1) var transmittance_lut : texture_storage_2d<rgba16float, write>;

fn find_closest_ray_circle_intersection(o: vec2<f32>, d: vec2<f32>, r: f32) -> f32 {
	return solve_quadratic_for_positive_reals(dot(d, d), 2.0 * dot(d, o), dot(o, o) - (r * r));
}

fn find_atmosphere_t_max_2d(t_max: ptr<function, f32>, o: vec2<f32>, d: vec2<f32>, bottom_radius: f32, top_radius: f32) -> bool {
	let t_bottom = find_closest_ray_circle_intersection(o, d, bottom_radius);
	let t_top = find_closest_ray_circle_intersection(o, d, top_radius);
	if t_bottom < 0.0 {
		if t_top < 0.0 {
			*t_max = 0.0;
			return false;
		} else {
			*t_max = t_top;
		}
	} else {
		if t_top > 0.0 {
			*t_max = min(t_top, t_bottom);
		} else {
			*t_max = 0.0;
		}
	}
	return true;
}

fn uv_to_transmittance_lut_params(uv: vec2<f32>, atmosphere: Atmosphere) -> vec2<f32> {
	let x_mu: f32 = uv.x;
	let x_r: f32 = uv.y;

	let bottom_radius_sq = atmosphere.bottom_radius * atmosphere.bottom_radius;
	let h_sq = atmosphere.top_radius * atmosphere.top_radius - bottom_radius_sq;
	let h: f32 = sqrt(h_sq);
	let rho: f32 = h * x_r;
	let rho_sq = rho * rho;
	let view_height = sqrt(rho_sq + bottom_radius_sq);

	let d_min: f32 = atmosphere.top_radius - view_height;
	let d_max: f32 = rho + h;
	let d: f32 = d_min + x_mu * (d_max - d_min);

	var cos_view_zenith = 1.0;
	if d != 0.0 {
		cos_view_zenith = clamp((h_sq - rho_sq - d * d) / (2.0 * view_height * d), -1.0, 1.0);
	}

	return vec2<f32>(view_height, cos_view_zenith);
}

@compute
@workgroup_size(WORKGROUP_SIZE_X, WORKGROUP_SIZE_Y, 1)
fn render_transmittance_lut(@builtin(global_invocation_id) global_id: vec3<u32>) {
	let output_size = vec2<u32>(textureDimensions(transmittance_lut));
	if output_size.x <= global_id.x || output_size.y <= global_id.y {
		return;
	}

	let pix = vec2<f32>(global_id.xy) + 0.5;
	let uv = pix / vec2<f32>(output_size);

	let atmosphere = atmosphere_buffer;

	// Compute camera position from LUT coords
	let lut_params = uv_to_transmittance_lut_params(uv, atmosphere);
	let view_height = lut_params.x;
	let cos_view_zenith = lut_params.y;
	let world_pos = vec2<f32>(0.0, view_height);
	let world_dir = vec2<f32>(sqrt(max(1.0 - cos_view_zenith * cos_view_zenith, 0.0)), cos_view_zenith);

	var transmittance = vec3<f32>();

	// Compute next intersection with atmosphere or ground
	var t_max: f32 = 0.0;
	if find_atmosphere_t_max_2d(&t_max, world_pos, world_dir, atmosphere.bottom_radius, atmosphere.top_radius) {
		t_max = min(t_max, t_max_max);

		// Sample count
		let sample_count = f32(SAMPLE_COUNT);	// Can go a low as 10 sample but energy lost starts to be visible.
		let sample_segment_t: f32 = 0.3f;
		let dt = t_max / sample_count;

		// Ray march the atmosphere to integrate optical depth
		var t = 0.0f;
		var dt_exact = 0.0f;
		for (var s: f32 = 0.0f; s < sample_count; s += 1.0f) {
			let t_new = (s + sample_segment_t) * dt;
			dt_exact = t_new - t;
			t = t_new;

			let sample_height = length(world_pos + t * world_dir) - atmosphere.bottom_radius;
			transmittance += sample_medium_extinction(sample_height, atmosphere) * dt_exact;
		}

		transmittance = exp(-transmittance);
	}

	textureStore(transmittance_lut, global_id.xy, vec4<f32>(transmittance, 1.0));
}
