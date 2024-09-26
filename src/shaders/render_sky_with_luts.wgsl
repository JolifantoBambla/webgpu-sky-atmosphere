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
@group(0) @binding(4) var sky_view_lut: texture_2d<f32>;
@group(0) @binding(5) var aerial_perspective_lut : texture_3d<f32>;
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

fn render_sky(pix: vec2<u32>) -> vec4<f32> {
	let atmosphere = atmosphere_buffer;
	let config = config_buffer;

	let uv = (vec2<f32>(pix) + 0.5) / vec2<f32>(config.screen_resolution);

	let world_dir = uv_to_world_dir(uv, config.inverse_projection, config.inverse_view);
	var world_pos = (config.camera_world_position * TO_KM_SCALE) - atmosphere.planet_center;
	let sun_dir = normalize(config.sun.direction);

	let view_height = length(world_pos);
	
	let depth = textureLoad(depth_buffer, pix, 0).r;
	if !is_valid_depth(depth) {
		return use_sky_view_lut(view_height, world_pos, world_dir, sun_dir, atmosphere, config);
	}

	let depth_buffer_world_pos = uv_and_depth_to_world_pos(uv, config.inverse_projection, config.inverse_view, depth);
	let t_depth = length(depth_buffer_world_pos - (world_pos + atmosphere.planet_center));

	var slice = aerial_perspective_depth_to_slice(t_depth);
	var weight = 1.0;
	if slice < 0.5 {
		// We multiply by weight to fade to 0 at depth 0. That works for luminance and opacity.
		weight = saturate(slice * 2.0);
		slice = 0.5;
	}
	let w = sqrt(slice / AP_SLICE_COUNT);	// squared distribution

	let aerial_perspective = textureSampleLevel(aerial_perspective_lut, lut_sampler, vec3<f32>(uv, w), 0);

	if all(aerial_perspective.rgb == vec3<f32>())  {
		return vec4<f32>();
	}

	return weight * aerial_perspective;
}

struct RenderSkyFragment {
	@location(0) luminance: vec4<f32>,
	@location(1) transmittance: vec4<f32>,
}

@fragment
fn fragment(@builtin(position) coord: vec4<f32>) -> RenderSkyFragment {
	let result = render_sky(vec2<u32>(floor(coord.xy)));
	return RenderSkyFragment(vec4<f32>(result.rgb, 1.0), vec4<f32>(vec3<f32>(result.a), 1.0));
}

@compute
@workgroup_size(WORKGROUP_SIZE_X, WORKGROUP_SIZE_Y, 1)
fn render_sky_atmosphere(@builtin(global_invocation_id) global_id: vec3<u32>) {
	let output_size = vec2<u32>(textureDimensions(render_target));
	if output_size.x <= global_id.x || output_size.y <= global_id.y {
		return;
	}
	blend(global_id.xy, render_sky(global_id.xy));
}

