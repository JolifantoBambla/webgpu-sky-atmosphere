/*
 * Copyright (c) 2024 Lukas Herzberger
 * SPDX-License-Identifier: MIT
 */

fn get_sample_shadow(atmosphere: Atmosphere, sample_position: vec3<f32>, light_index: u32) -> f32 {
	return get_shadow((sample_position + atmosphere.planet_center) * FROM_KM_SCALE, light_index);
}
