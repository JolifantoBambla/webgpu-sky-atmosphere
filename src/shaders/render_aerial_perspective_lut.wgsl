/*
 * Copyright (c) 2024 Lukas Herzberger
 * Copyright (c) 2020 Epic Games, Inc.
 * SPDX-License-Identifier: MIT
 */

override USE_MOON: bool = false;

override WORKGROUP_SIZE_X: u32 = 16;
override WORKGROUP_SIZE_Y: u32 = 16;

@group(0) @binding(0) var<uniform> atmosphere_buffer: Atmosphere;
@group(0) @binding(1) var<uniform> config_buffer: Uniforms;
@group(0) @binding(2) var lut_sampler: sampler;
@group(0) @binding(3) var transmittance_lut: texture_2d<f32>;
@group(0) @binding(4) var multi_scattering_lut: texture_2d<f32>;
@group(0) @binding(5) var aerial_perspective_lut: texture_storage_3d<rgba16float, write>;

struct SingleScatteringResult {
	luminance: vec3<f32>,				// Scattered light (luminance)
	transmittance: vec3<f32>,			// Transmittance in [0,1] (unitless)
}

fn integrate_scattered_luminance(uv: vec2<f32>, world_pos: vec3<f32>, world_dir: vec3<f32>, atmosphere: Atmosphere, config: Uniforms, sample_count: f32, t_max_bound: f32) -> SingleScatteringResult {
	var result = SingleScatteringResult();

	let planet_center = vec3<f32>();
	var t_max: f32 = 0.0;
	if !find_atmosphere_t_max(&t_max, world_pos, world_dir, planet_center, atmosphere.bottom_radius, atmosphere.top_radius) {
		return result;
	}
	t_max = min(t_max, t_max_bound);

	let sample_segment_t = get_sample_segment_t(uv, config);
	let dt = t_max / sample_count;

	let sun_direction = normalize(config.sun.direction);
	let sun_illuminance = config.sun.illuminance;

	let cos_theta = dot(sun_direction, world_dir);
	let mie_phase_val = mie_phase(cos_theta, atmosphere.mie_phase_param);
	let rayleigh_phase_val = rayleigh_phase(cos_theta);

	var moon_direction = config.moon.direction;
	var moon_illuminance = config.moon.illuminance;

	var cos_theta_moon = 0.0;
	var mie_phase_val_moon = 0.0;
	var rayleigh_phase_val_moon = 0.0;

	if USE_MOON {
		moon_direction = normalize(moon_direction);
		moon_illuminance = config.moon.illuminance;

		cos_theta_moon = dot(moon_direction, world_dir);
		mie_phase_val_moon = mie_phase(cos_theta_moon, atmosphere.mie_phase_param);
		rayleigh_phase_val_moon = rayleigh_phase(cos_theta_moon);
	}

	result.luminance = vec3<f32>(0.0);
	result.transmittance = vec3<f32>(1.0);
	var t = 0.0;
	var dt_exact = 0.0;
	for (var s = 0.0; s < sample_count; s += 1.0) {
		let t_new = (s + sample_segment_t) * dt;
		dt_exact = t_new - t;
		t = t_new;

		let sample_pos = world_pos + t * world_dir;
		let sample_height = length(sample_pos);

		let medium = sample_medium(sample_height - atmosphere.bottom_radius, atmosphere);
		let sample_transmittance = exp(-medium.extinction * dt_exact);

		let zenith = sample_pos / sample_height;

		let cos_sun_zenith = dot(sun_direction, zenith);
		let transmittance_to_sun = textureSampleLevel(transmittance_lut, lut_sampler, transmittance_lut_params_to_uv(atmosphere, sample_height, cos_sun_zenith), 0).rgb;
		let phase_times_scattering = medium.mie_scattering * mie_phase_val + medium.rayleigh_scattering * rayleigh_phase_val;
		let multi_scattered_luminance = get_multiple_scattering(atmosphere, medium.scattering, medium.extinction, sample_pos, cos_sun_zenith);
		let planet_shadow = compute_planet_shadow(sample_pos, sun_direction, planet_center + planet_radius_offset * zenith, atmosphere.bottom_radius);
		let shadow = get_sample_shadow(atmosphere, sample_pos, 0);

		var scattered_luminance = sun_illuminance * (planet_shadow * shadow * transmittance_to_sun * phase_times_scattering + multi_scattered_luminance * medium.scattering);

		if USE_MOON {
			let cos_moon_zenith = dot(moon_direction, zenith);
			let transmittance_to_moon = textureSampleLevel(transmittance_lut, lut_sampler, transmittance_lut_params_to_uv(atmosphere, sample_height, cos_moon_zenith), 0).rgb;
			let phase_times_scattering_moon = medium.mie_scattering * mie_phase_val_moon + medium.rayleigh_scattering * rayleigh_phase_val_moon;
			let multi_scattered_luminance_moon = get_multiple_scattering(atmosphere, medium.scattering, medium.extinction, sample_pos, cos_moon_zenith);
			let planet_shadow_moon = compute_planet_shadow(sample_pos, moon_direction, planet_center + planet_radius_offset * zenith, atmosphere.bottom_radius);
			let shadow_moon = get_sample_shadow(atmosphere, sample_pos, 1);

			scattered_luminance += moon_illuminance * (planet_shadow_moon * shadow_moon * transmittance_to_moon * phase_times_scattering_moon + multi_scattered_luminance_moon * medium.scattering);
		}

		let intergrated_luminance = (scattered_luminance - scattered_luminance * sample_transmittance) / medium.extinction;
		result.luminance += result.transmittance * intergrated_luminance;
		result.transmittance *= sample_transmittance;
	}

	return result;
}

fn thread_z_to_slice(thread_z: u32) -> f32 {
	let slice = ((f32(thread_z) + 0.5) / AP_SLICE_COUNT);
	return (slice * slice) * AP_SLICE_COUNT; // squared distribution
}

@compute
@workgroup_size(WORKGROUP_SIZE_X, WORKGROUP_SIZE_Y, 1)
fn render_aerial_perspective_lut(@builtin(global_invocation_id) global_id: vec3<u32>) {
	let output_size = vec2<u32>(textureDimensions(aerial_perspective_lut).xy);
	if output_size.x <= global_id.x || output_size.y <= global_id.y {
		return;
	}

	let atmosphere = atmosphere_buffer;
	let config = config_buffer;

	let pix = vec2<f32>(global_id.xy) + 0.5;
	let uv = pix / vec2<f32>(output_size.xy);

	var world_dir = uv_to_world_dir(uv, config.inverse_projection, config.inverse_view);
	let cam_pos = (config.camera_world_position * TO_KM_SCALE) - atmosphere.planet_center;

	var world_pos = cam_pos;

	var t_max = aerial_perspective_slice_to_depth(thread_z_to_slice(global_id.z));
	var slice_start_pos = world_pos + t_max * world_dir;

	var view_height = length(slice_start_pos);
	if view_height <= (atmosphere.bottom_radius + planet_radius_offset) {
		slice_start_pos = normalize(slice_start_pos) * (atmosphere.bottom_radius + planet_radius_offset + 0.001);
		world_dir = normalize(slice_start_pos - cam_pos);
		t_max = length(slice_start_pos - cam_pos);
	}

	view_height = length(world_pos);
	if view_height >= atmosphere.top_radius {
		let prev_world_pos = world_pos;
		if !move_to_atmosphere_top(&world_pos, world_dir, atmosphere.top_radius) {
			textureStore(aerial_perspective_lut, global_id, vec4<f32>(0.0, 0.0, 0.0, 1.0));
			return;
		}
		let distance_to_atmosphere = length(prev_world_pos - world_pos);
		if t_max < distance_to_atmosphere {
			textureStore(aerial_perspective_lut, global_id, vec4<f32>(0.0, 0.0, 0.0, 1.0));
			return;
		}
		t_max = max(0.0, t_max - distance_to_atmosphere);
	}

	let sample_count = max(1.0, f32(global_id.z + 1) * 2.0);
	let ss = integrate_scattered_luminance(uv, world_pos, world_dir, atmosphere, config, sample_count, t_max);

	let transmittance = dot(ss.transmittance, vec3<f32>(1.0 / 3.0));
	textureStore(aerial_perspective_lut, global_id, vec4<f32>(ss.luminance, 1.0 - transmittance));
}
