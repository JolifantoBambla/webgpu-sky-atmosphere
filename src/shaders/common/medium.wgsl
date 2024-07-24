/*
 * Copyright (c) 2024 Lukas Herzberger
 * Copyright (c) 2020 Epic Games, Inc.
 * SPDX-License-Identifier: MIT
 */

struct Atmosphere {
	// Rayleigh scattering coefficients
	rayleigh_scattering: vec3<f32>,
	// Rayleigh scattering exponential distribution scale in the atmosphere
	rayleigh_density_exp_scale: f32,

	// Mie scattering coefficients
	mie_scattering: vec3<f32>,
	// Mie scattering exponential distribution scale in the atmosphere
	mie_density_exp_scale: f32,
	// Mie extinction coefficients
	mie_extinction: vec3<f32>,
	// Mie phase function excentricity
	mie_phase_g: f32,
	// Mie absorption coefficients
	mie_absorption: vec3<f32>,
	
	// Another medium type in the atmosphere
	absorption_density_0_layer_height: f32,
	absorption_density_0_constant_term: f32,
	absorption_density_0_linear_term: f32,
	absorption_density_1_constant_term: f32,
	absorption_density_1_linear_term: f32,
	// This other medium only absorb light, e.g. useful to represent ozone in the earth atmosphere
	absorption_extinction: vec3<f32>,

	// Radius of the planet (center to ground)
	bottom_radius: f32,

	// The albedo of the ground.
	ground_albedo: vec3<f32>,

	// Maximum considered atmosphere height (center to atmosphere top)
	top_radius: f32,

	// planet center in world space (z up)
	// used to transform the camera's position to the atmosphere's object space
	planet_center: vec3<f32>,
	
	multi_scattering_factor: f32,
}

fn make_earth_atmosphere() -> Atmosphere {
	let earth_rayleigh_scale_height = 8.0;
	let earth_mie_scale_height = 1.2;

	var atmosphere: Atmosphere;

	atmosphere.bottom_radius = 6360.0;
	atmosphere.top_radius = 6460.0;

	atmosphere.rayleigh_density_exp_scale = -1.0 / earth_rayleigh_scale_height;
	atmosphere.rayleigh_scattering = vec3(0.005802, 0.013558, 0.033100);    // 1/km

	atmosphere.mie_density_exp_scale = -1.0 / earth_mie_scale_height;
	atmosphere.mie_scattering = vec3(0.003996, 0.003996, 0.003996);			// 1/km
	atmosphere.mie_extinction = vec3(0.004440, 0.004440, 0.004440);			// 1/km
	atmosphere.mie_absorption = max(atmosphere.mie_extinction - atmosphere.mie_scattering, vec3());
	atmosphere.mie_phase_g = 0.8;
	
	atmosphere.absorption_extinction = vec3(0.000650, 0.001881, 0.000085);	// 1/km
	atmosphere.absorption_density_0_layer_height = 25.0;
	atmosphere.absorption_density_0_constant_term = -2.0 / 3.0;
	atmosphere.absorption_density_0_linear_term = 1.0 / 15.0;
	atmosphere.absorption_density_1_constant_term = 8.0 / 3.0;
	atmosphere.absorption_density_1_linear_term = -1.0 / 15.0;

	atmosphere.ground_albedo = vec3(0.0, 0.0, 0.0);

	atmosphere.multi_scattering_factor = 1.0;
	
	return atmosphere;
}

struct MediumSample {
	scattering: vec3<f32>,
	extinction: vec3<f32>,

	mie_scattering: vec3<f32>,
	rayleigh_scattering: vec3<f32>,
}

/*
 * origin is the planet's center
 */
fn sample_medium_extinction(height: f32, atmosphere: Atmosphere) -> vec3<f32> {
	let mie_density: f32 = exp(atmosphere.mie_density_exp_scale * height);
	let rayleigh_density: f32 = exp(atmosphere.rayleigh_density_exp_scale * height);
	var absorption_density: f32;
	if height < atmosphere.absorption_density_0_layer_height {
		absorption_density = saturate(atmosphere.absorption_density_0_linear_term * height + atmosphere.absorption_density_0_constant_term);
	} else {
		absorption_density = saturate(atmosphere.absorption_density_1_linear_term * height + atmosphere.absorption_density_1_constant_term);
	}

	let mie_extinction = mie_density * atmosphere.mie_extinction;
	let rayleigh_extinction = rayleigh_density * atmosphere.rayleigh_scattering;
	let absorption_extinction = absorption_density * atmosphere.absorption_extinction;

	return mie_extinction + rayleigh_extinction + absorption_extinction;
}

fn sample_medium(height: f32, atmosphere: Atmosphere) -> MediumSample {
	let mie_density: f32 = exp(atmosphere.mie_density_exp_scale * height);
	let rayleigh_density: f32 = exp(atmosphere.rayleigh_density_exp_scale * height);
	var absorption_density: f32;
	if height < atmosphere.absorption_density_0_layer_height {
		absorption_density = saturate(atmosphere.absorption_density_0_linear_term * height + atmosphere.absorption_density_0_constant_term);
	} else {
		absorption_density = saturate(atmosphere.absorption_density_1_linear_term * height + atmosphere.absorption_density_1_constant_term);
	}

	var s: MediumSample;
	s.mie_scattering = mie_density * atmosphere.mie_scattering;
	s.rayleigh_scattering = rayleigh_density * atmosphere.rayleigh_scattering;
	s.scattering = s.mie_scattering + s.rayleigh_scattering;

	let mie_extinction = mie_density * atmosphere.mie_extinction;
	let rayleigh_extinction = s.rayleigh_scattering;
	let absorption_extinction = absorption_density * atmosphere.absorption_extinction;
	s.extinction = mie_extinction + rayleigh_extinction + absorption_extinction;

	return s;
}
