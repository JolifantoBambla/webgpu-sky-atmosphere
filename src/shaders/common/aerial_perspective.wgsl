override AP_SLICE_COUNT: f32 = 32.0;
override AP_KM_PER_SLICE: f32 = 4.0;

fn aerial_perspective_depth_to_slice(depth: f32) -> f32 {
	return depth * (1.0 / AP_KM_PER_SLICE);
}
fn aerial_perspective_slice_to_depth(slice: f32) -> f32 {
	return slice * AP_KM_PER_SLICE;
}
