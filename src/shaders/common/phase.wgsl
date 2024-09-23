/*
 * Copyright (c) 2024 Lukas Herzberger
 * Copyright (c) 2020 Epic Games, Inc.
 * SPDX-License-Identifier: MIT
 */


override MIE_USE_HG_DRAINE: bool = false;
override MIE_USE_HG_DRAINE_DYNAMIC: bool = false;

// https://research.nvidia.com/labs/rtr/approximate-mie/publications/approximate-mie.pdf
// cloud water droplet diameter in µm (should be 5 µm < d < 50 µm)
override HG_DRAINE_DROPLET_DIAMETER: f32 = 3.4;
override HG_DRAINE_G_HG = exp(-(0.0990567 / (HG_DRAINE_DROPLET_DIAMETER - 1.67154)));
override HG_DRAINE_G_D = exp(-(2.20679 / (HG_DRAINE_DROPLET_DIAMETER + 3.91029)) - 0.428934);
override HG_DRAINE_W_D = exp(-(0.599085 / (HG_DRAINE_DROPLET_DIAMETER - 0.641583)) - 0.665888);
override HG_DRAINE_ALPHA = exp(3.62489 - (8.29288 / (HG_DRAINE_DROPLET_DIAMETER + 5.52825)));

override HG_DRAINE_ALPHA_THIRDS = HG_DRAINE_ALPHA / 3.0;
override HG_DRAINE_G_HG_2 = HG_DRAINE_G_HG * HG_DRAINE_G_HG;
override HG_DRAINE_G_D_2 = HG_DRAINE_G_D * HG_DRAINE_G_D;
override HG_DRAINE_CONST_DENOM = 1.0 / (1.0 + (HG_DRAINE_ALPHA * (1.0 / 3.0) * (1.0 + (2.0 * HG_DRAINE_G_D_2))));

const one_over_four_pi = 1.0 / (2.0 * tau);

const isotropic_phase: f32 = 1.0 / sphere_solid_angle;

fn draine_phase_hg(cos_theta: f32) -> f32 {
    return one_over_four_pi *
        ((1.0 - HG_DRAINE_G_HG_2) / pow((1.0 + HG_DRAINE_G_HG_2 - (2.0 * HG_DRAINE_G_HG * cos_theta)), 1.5));
}

fn draine_phase_d(cos_theta: f32) -> f32 {
    return one_over_four_pi *
          ((1.0 - HG_DRAINE_G_D_2) / pow((1.0 + HG_DRAINE_G_D_2 - (2.0 * HG_DRAINE_G_D * cos_theta)), 1.5)) *
          ((1.0 + (HG_DRAINE_ALPHA * cos_theta * cos_theta)) * HG_DRAINE_CONST_DENOM);
}

fn hg_draine_phase(cos_theta: f32) -> f32 {
    return mix(draine_phase_hg(cos_theta), draine_phase_d(cos_theta), HG_DRAINE_W_D);
}

fn draine_phase_dynamic(alpha: f32, g: f32, cos_theta: f32) -> f32 {
    let g2 = g * g;
   return one_over_four_pi *
          ((1.0 - g2) / pow((1.0 + g2 - (2.0 * g * cos_theta)), 1.5)) *
          ((1.0 + (alpha * cos_theta * cos_theta)) / (1.0 + (alpha * (1.0 / 3.0) * (1.0 + (2.0 * g2)))));
}

fn hg_draine_phase_dynamic(cos_theta: f32, diameter: f32) -> f32 {
    let g_hg = exp(-(0.0990567 / (diameter - 1.67154)));
    let g_d = exp(-(2.20679 / (diameter + 3.91029)) - 0.428934);
    let alpha = exp(3.62489 - (8.29288 / (diameter + 5.52825)));
    let w_d = exp(-(0.599085 / (diameter - 0.641583)) - 0.665888);
    return mix(draine_phase_dynamic(0, g_hg, cos_theta), draine_phase_dynamic(alpha, g_d, cos_theta), w_d);
}

fn cornette_shanks_phase(g: f32, cos_theta: f32) -> f32 {
	let k: f32 = 3.0 / (8.0 * pi) * (1.0 - g * g) / (2.0 + g * g);
	return k * (1.0 + cos_theta * cos_theta) / pow(1.0 + g * g - 2.0 * g * -cos_theta, 1.5);
}

fn mie_phase(cos_theta: f32, g_or_d: f32) -> f32 {
    if MIE_USE_HG_DRAINE {
        if MIE_USE_HG_DRAINE_DYNAMIC {
            return hg_draine_phase_dynamic(cos_theta, g_or_d);
        } else {
            return hg_draine_phase(cos_theta);
        }
    } else {
        return cornette_shanks_phase(-cos_theta, g_or_d);
    }
}

fn rayleigh_phase(cos_theta: f32) -> f32 {
	let factor: f32 = 3.0f / (16.0f * pi);
	return factor * (1.0f + cos_theta * cos_theta);
}
