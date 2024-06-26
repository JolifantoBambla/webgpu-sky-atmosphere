fn get_multiple_scattering(atmosphere: Atmosphere, scattering: vec3<f32>, extinction: vec3<f32>, worl_pos: vec3<f32>, cos_view_zenith: f32) -> vec3<f32> {
    var uv = saturate(vec2(cos_view_zenith * 0.5 + 0.5, (length(worl_pos) - atmosphere.bottom_radius) / (atmosphere.top_radius - atmosphere.bottom_radius)));
	uv = vec2(from_unit_to_sub_uvs(uv.x, MULTI_SCATTERING_LUT_RES), from_unit_to_sub_uvs(uv.y, MULTI_SCATTERING_LUT_RES));
	return textureSampleLevel(multi_scattering_lut, lut_sampler, uv, 0).rgb;
}
