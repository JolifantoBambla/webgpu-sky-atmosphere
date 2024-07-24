/*
 * Copyright (c) 2024 Lukas Herzberger
 * Copyright (c) 2020 Epic Games, Inc.
 * SPDX-License-Identifier: MIT
 */

override AP_SLICE_COUNT: f32 = 32.0;
override AP_DISTANCE_PER_SLICE: f32 = 4.0;

override AP_INV_DISTANCE_PER_SLICE: f32 = 1.0 / AP_DISTANCE_PER_SLICE;

fn aerial_perspective_depth_to_slice(depth: f32) -> f32 {
	return depth * AP_INV_DISTANCE_PER_SLICE;
}
fn aerial_perspective_slice_to_depth(slice: f32) -> f32 {
	return slice * AP_DISTANCE_PER_SLICE;
}
