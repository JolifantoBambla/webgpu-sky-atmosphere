/*
 * Copyright (c) 2024 Lukas Herzberger
 * Copyright (c) 2020 Epic Games, Inc.
 * SPDX-License-Identifier: MIT
 */

override USE_MOON: bool = false;
override INV_DISTANCE_TO_MAX_SAMPLE_COUNT: f32 = 1.0 / 100.0;
override USE_COLORED_TRANSMISSION: bool = true;

override WORKGROUP_SIZE_X: u32 = 16;
override WORKGROUP_SIZE_Y: u32 = 16;

@group(0) @binding(0) var<uniform> atmosphere_buffer: Atmosphere;
@group(0) @binding(1) var<uniform> config_buffer: Uniforms;
@group(0) @binding(2) var lut_sampler: sampler;
@group(0) @binding(3) var transmittance_lut: texture_2d<f32>;
@group(0) @binding(4) var multi_scattering_lut: texture_2d<f32>;
@group(0) @binding(5) var sky_view_lut: texture_2d<f32>;
@group(0) @binding(6) var depth_buffer: texture_2d<f32>;
@group(0) @binding(7) var backbuffer: texture_2d<f32>;
@group(0) @binding(8) var render_target: texture_storage_2d<rgba16float, write>;

fn use_sky_view_lut(view_height: f32, world_pos: vec3<f32>, world_dir: vec3<f32>, sun_dir: vec3<f32>, atmosphere: Atmosphere, config: Uniforms) -> vec4<f32> {
	let zenith = normalize(world_pos);
	let cos_view_zenith = dot(world_dir, zenith);

	let side = normalize(cross(zenith, world_dir));	// assumes non parallel vectors
	let forward = normalize(cross(side, zenith));	// aligns toward the sun light but perpendicular to up vector
	let cos_light_view = normalize(vec2<f32>(dot(sun_dir, forward), dot(sun_dir, side))).x;

	let intersects_ground = ray_intersects_sphere(world_pos, world_dir, vec3<f32>(), atmosphere.bottom_radius);

	let uv = sky_view_lut_params_to_uv(atmosphere, intersects_ground, cos_view_zenith, cos_light_view, view_height);

	let sky_view = textureSampleLevel(sky_view_lut, lut_sampler, uv, 0);

	return vec4<f32>(sky_view.rgb + get_sun_luminance(world_pos, world_dir, atmosphere, config), sky_view.a);
}

struct SingleScatteringResult {
	luminance: vec3<f32>,				// Scattered light (luminance)
	transmittance: vec3<f32>,			// transmittance in [0,1] (unitless)
}

fn integrate_scattered_luminance(uv: vec2<f32>, world_pos: vec3<f32>, world_dir: vec3<f32>, atmosphere: Atmosphere, depth: f32, config: Uniforms) -> SingleScatteringResult {
	var result = SingleScatteringResult();

	let planet_center = vec3<f32>();
	var t_max: f32 = 0.0;
	if !find_atmosphere_t_max(&t_max, world_pos, world_dir, planet_center, atmosphere.bottom_radius, atmosphere.top_radius) {
		return result;
	}

	if is_valid_depth(depth) {
		let depth_buffer_world_pos = uv_and_depth_to_world_pos(uv, config.inverse_projection, config.inverse_view, depth);
		t_max = min(t_max, length(depth_buffer_world_pos - (world_pos + atmosphere.planet_center)));
	}
	t_max = min(t_max, t_max_max);

	let sample_count = mix(config.ray_march_min_spp, config.ray_march_max_spp, saturate(t_max * INV_DISTANCE_TO_MAX_SAMPLE_COUNT));
	let sample_count_floored = floor(sample_count);
	let inv_sample_count_floored = 1.0 / sample_count_floored;
	let t_max_floored = t_max * sample_count_floored / sample_count;
	let sample_segment_t = get_sample_segment_t(uv, config);

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
	var dt = 0.0;
	for (var s = 0.0; s < sample_count; s += 1.0) {
		var t0 = s * inv_sample_count_floored;
		var t1 = (s + 1.0) * inv_sample_count_floored;
		t0 = (t0 * t0) * t_max_floored;
		t1 = t1 * t1;
		if t1 > 1.0 {
			t1 = t_max;
		} else {
			t1 = t_max_floored * t1;
		}
		dt = t1 - t0;
		t = t0 + dt * sample_segment_t;

		let sample_pos = world_pos + t * world_dir;
		let sample_height= length(sample_pos);

		let medium = sample_medium(sample_height - atmosphere.bottom_radius, atmosphere);
		let sample_transmittance = exp(-medium.extinction * dt);

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

struct RenderSkyResult {
	luminance: vec4<f32>,
	transmittance: vec4<f32>,
}

fn render_sky(pix: vec2<u32>) -> RenderSkyResult {
	let atmosphere = atmosphere_buffer;
	let config = config_buffer;

	let uv = (vec2<f32>(pix) + 0.5) / vec2<f32>(config.screen_resolution);

	let world_dir = uv_to_world_dir(uv, config.inverse_projection, config.inverse_view);
	var world_pos = (config.camera_world_position * TO_KM_SCALE)- atmosphere.planet_center;
	let sun_dir = normalize(config.sun.direction);

	let view_height = length(world_pos);

	let depth = textureLoad(depth_buffer, pix, 0).r;
	if !is_valid_depth(depth) {
		let sky_view = use_sky_view_lut(view_height, world_pos, world_dir, sun_dir, atmosphere, config);
		return RenderSkyResult(vec4<f32>(sky_view.rgb, 1.0), vec4<f32>(vec3<f32>(sky_view.a), 1.0));
	}
	
	if !move_to_atmosphere_top(&world_pos, world_dir, atmosphere.top_radius) {
		let black = vec4<f32>(vec3<f32>(), 1.0);
		return RenderSkyResult(black, black);
	}
	
	let ss = integrate_scattered_luminance(uv, world_pos, world_dir, atmosphere, depth, config);

	return RenderSkyResult(max(vec4<f32>(ss.luminance, 1.0), vec4<f32>()), max(vec4<f32>(ss.transmittance, 1.0), vec4<f32>()));
}

struct RenderSkyFragment {
	@location(0) luminance: vec4<f32>,
	@location(1) transmittance: vec4<f32>,
}

@fragment
fn fragment(@builtin(position) coord: vec4<f32>) -> RenderSkyFragment {
	let result = render_sky(vec2<u32>(floor(coord.xy)));
	return RenderSkyFragment(result.luminance, result.transmittance);
}

@compute
@workgroup_size(WORKGROUP_SIZE_X, WORKGROUP_SIZE_Y)
fn render_sky_atmosphere(@builtin(global_invocation_id) global_id: vec3<u32>) {
	let output_size = vec2<u32>(textureDimensions(render_target));
	if output_size.x <= global_id.x || output_size.y <= global_id.y {
		return;
	}
	let result = render_sky(global_id.xy);
	if USE_COLORED_TRANSMISSION {
		dual_source_blend(global_id.xy, result.luminance, result.transmittance);
	} else {
		blend(global_id.xy, vec4<f32>(result.luminance.rgb, 1.0 - dot(result.transmittance.rgb, vec3<f32>(1.0 / 3.0))));
	}
}

