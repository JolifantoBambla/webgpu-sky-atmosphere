/*
 * Copyright (c) 2024 Lukas Herzberger
 * Copyright (c) 2020 Epic Games, Inc.
 * SPDX-License-Identifier: MIT
 */

struct AtmosphereLight {
	// Sun light's illuminance
	illuminance: vec3<f32>,
	
	// Sun disk's angular diameter in radians
	disk_diameter: f32,
	
	// Sun light's direction (direction pointing to the sun)
	direction: vec3<f32>,

	// Sun disk's luminance
	disk_luminance_scale: f32,
}

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

	// Sun parameters
	sun: AtmosphereLight,

	// Moon / second sun parameters 
	moon: AtmosphereLight,
}

