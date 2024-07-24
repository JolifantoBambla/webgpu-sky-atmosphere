/*
 * Copyright (c) 2024 Lukas Herzberger
 * SPDX-License-Identifier: MIT
 */

override RANDOMIZE_SAMPLE_OFFSET: bool = true;

fn pcg_hash(seed: u32) -> u32 {
	let state = seed * 747796405u + 2891336453u;
	let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
	return (word >> 22u) ^ word;
}

fn pcg_hashf(seed: u32) -> f32 {
	return f32(pcg_hash(seed)) / 4294967296.0;
}

fn pcg_hash3(x: u32, y: u32, z: u32) -> f32 {
	return pcg_hashf((x * 1664525 + y) + z);
}

fn get_sample_segment_t(uv: vec2<f32>, config: Uniforms) -> f32 {
	if RANDOMIZE_SAMPLE_OFFSET {
		let seed = vec3<u32>(
			u32(uv.x * config.screen_resolution.x),
			u32(uv.y * config.screen_resolution.y),
			pcg_hash(u32(config.frame_id)),
		);
		return pcg_hash3(seed.x, seed.y, seed.z);
	} else {
		return 0.3;
	}
}
