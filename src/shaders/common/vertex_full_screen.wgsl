@vertex
fn vertex(@builtin(vertex_index) vertex_index: u32) -> @builtin(position) vec4<f32> {
    return vec4(vec2(f32((vertex_index << 1) & 2), f32(vertex_index & 2)) * 2 - 1, 0, 1);
}
