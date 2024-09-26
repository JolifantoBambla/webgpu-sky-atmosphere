/*
 * Copyright (c) 2024 Lukas Herzberger
 * SPDX-License-Identifier: MIT
 */

// 1.5 µm <= 𝑑 < 5 µm
override HG_DRAINE_G_HG = 0.0604931 * log(log(HG_DRAINE_DROPLET_DIAMETER)) + 0.940256;
override HG_DRAINE_G_D = 0.500411 - 0.081287 / (-2.0 * log(HG_DRAINE_DROPLET_DIAMETER) + tan(log(HG_DRAINE_DROPLET_DIAMETER)) + 1.27551);
override HG_DRAINE_ALPHA = 7.30354 * log(HG_DRAINE_DROPLET_DIAMETER) + 6.31675;
override HG_DRAINE_W_D = 0.026914 * (log(HG_DRAINE_DROPLET_DIAMETER) - cos(5.68947 * (log(log(HG_DRAINE_DROPLET_DIAMETER)) - 0.0292149))) + 0.376475;
