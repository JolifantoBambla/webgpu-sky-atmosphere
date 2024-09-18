/*
 * Copyright (c) 2024 Lukas Herzberger
 * Copyright (c) 2020 Epic Games, Inc.
 * SPDX-License-Identifier: MIT
 */
 
const isotropic_phase: f32 = 1.0 / sphere_solid_angle;

fn cornette_shanks_phase(g: f32, cos_theta: f32) -> f32 {
	let k: f32 = 3.0 / (8.0 * pi) * (1.0 - g * g) / (2.0 + g * g);
	return k * (1.0 + cos_theta * cos_theta) / pow(1.0 + g * g - 2.0 * g * -cos_theta, 1.5);
}

// https://research.nvidia.com/labs/rtr/approximate-mie/publications/approximate-mie.pdf
fn draine_phase(alpha: f32, g: f32, cos_theta: f32) -> f32 {
	let g2 = g * g;
    return (1.0 / (2.0 * tau)) *
           ((1.0 - g2) / pow((1.0 + g2 - (2.0 * g * cos_theta)), 3.0 / 2.0)) *
           ((1.0 + (alpha * cos_theta * cos_theta)) / (1.0 + (alpha * (1.0 / 3.0) * (1.0 + (2.0 * g2)))));
}

fn hg_draine_phase(diameter: f32, cos_theta: f32) -> f32 {
    let g_hg = exp(-(0.0990567 / (diameter - 1.67154)));
    let g_d = exp(-(2.20679 / (diameter + 3.91029)) - 0.428934);
    let alpha = exp(3.62489 - (8.29288 / (diameter + 5.52825)));
    let w_d = exp(-(0.599085 / (diameter - 0.641583)) - 0.665888);
    return (1 - w_d) * draine_phase(0, g_hg, cos_theta) + w_d * draine_phase(alpha, g_d, cos_theta);
}

fn rayleigh_phase(cos_theta: f32) -> f32 {
	let factor: f32 = 3.0f / (16.0f * pi);
	return factor * (1.0f + cos_theta * cos_theta);
}
