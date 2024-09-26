/*
 * Copyright (c) 2024 Lukas Herzberger
 * SPDX-License-Identifier: MIT
 */

override HG_DRAINE_ALPHA_THIRDS = HG_DRAINE_ALPHA / 3.0;
override HG_DRAINE_G_HG_2 = HG_DRAINE_G_HG * HG_DRAINE_G_HG;
override HG_DRAINE_G_D_2 = HG_DRAINE_G_D * HG_DRAINE_G_D;
override HG_DRAINE_CONST_DENOM = 1.0 / (1.0 + (HG_DRAINE_ALPHA * (1.0 / 3.0) * (1.0 + (2.0 * HG_DRAINE_G_D_2))));

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
