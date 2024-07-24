/*
 * Copyright (c) 2024 Lukas Herzberger
 * SPDX-License-Identifier: MIT
 */

override IS_REVERSE_Z: bool = true;

fn depth_max() -> f32 {
    if IS_REVERSE_Z {
        return 0.0000001;
    } else {
        return 1.0;
    }
}

fn is_valid_depth(depth: f32) -> bool {
    if IS_REVERSE_Z {
        return depth > 0.0 && depth <= 1.0;
    } else {
        return depth < 1.0 && depth >= 0.0;
    }
}

fn uv_to_world_dir(uv: vec2<f32>, inv_proj: mat4x4<f32>, inv_view: mat4x4<f32>) -> vec3<f32> {
    let hom_view_space = inv_proj * vec4(vec3(uv * vec2(2.0, -2.0) - vec2(1.0, -1.0), depth_max()), 1.0);
    return normalize((inv_view * vec4(hom_view_space.xyz / hom_view_space.w, 0.0)).xyz);
}

fn uv_and_depth_to_world_pos(uv: vec2<f32>, inv_proj: mat4x4<f32>, inv_view: mat4x4<f32>, depth: f32) -> vec3<f32> {
    let hom_view_space = inv_proj * vec4(vec3(uv * vec2(2.0, -2.0) - vec2(1.0, -1.0), depth), 1.0);
    return (inv_view * vec4(hom_view_space.xyz / hom_view_space.w, 1.0)).xyz;
}
