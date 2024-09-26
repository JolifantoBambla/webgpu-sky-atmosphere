/*
 * Copyright (c) 2024 Lukas Herzberger
 * SPDX-License-Identifier: MIT
 */

// 5 µm ≤ 𝑑 ≤ 50 µm
override HG_DRAINE_G_HG = exp(-(0.0990567 / (HG_DRAINE_DROPLET_DIAMETER - 1.67154)));
override HG_DRAINE_G_D = exp(-(2.20679 / (HG_DRAINE_DROPLET_DIAMETER + 3.91029)) - 0.428934);
override HG_DRAINE_ALPHA = exp(3.62489 - (8.29288 / (HG_DRAINE_DROPLET_DIAMETER + 5.52825)));
override HG_DRAINE_W_D = exp(-(0.599085 / (HG_DRAINE_DROPLET_DIAMETER - 0.641583)) - 0.665888);
