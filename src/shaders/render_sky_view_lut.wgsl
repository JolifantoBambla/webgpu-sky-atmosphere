override IS_Y_UP: bool = true;
override IS_RIGHT_HANDED: bool = true;

override SKY_VIEW_LUT_RES_X: f32 = 192.0;
override SKY_VIEW_LUT_RES_Y: f32 = 108.0;
override MULTI_SCATTERING_LUT_RES: f32 = 32.0;

override WORKGROUP_SIZE_X: u32 = 16;
override WORKGROUP_SIZE_Y: u32 = 16;

@group(0) @binding(0) var<uniform> atmosphere_buffer: Atmosphere;
@group(0) @binding(1) var<uniform> config_buffer: Config;

@group(1) @binding(0) var lut_sampler: sampler;

@group(2) @binding(0) var transmittance_lut: texture_2d<f32>;
@group(2) @binding(1) var multi_scattering_lut: texture_2d<f32>;
@group(2) @binding(2) var sky_view_lut : texture_storage_2d<rgba16float, write>;

fn get_multiple_scattering(atmosphere: Atmosphere, scattering: vec3<f32>, extinction: vec3<f32>, worl_pos: vec3<f32>, cos_view_zenith: f32) -> vec3<f32> {
    var uv = saturate(vec2(cos_view_zenith * 0.5 + 0.5, (length(worl_pos) - atmosphere.bottom_radius) / (atmosphere.top_radius - atmosphere.bottom_radius)));
	uv = vec2(from_unit_to_sub_uvs(uv.x, MULTI_SCATTERING_LUT_RES), from_unit_to_sub_uvs(uv.y, MULTI_SCATTERING_LUT_RES));
	return textureSampleLevel(multi_scattering_lut, lut_sampler, uv, 0).rgb;
}

fn integrate_scattered_luminance(pix: vec2<f32>, world_pos: vec3<f32>, world_dir: vec3<f32>, sun_dir: vec3<f32>, atmosphere: Atmosphere, sun_illuminance: vec3<f32>, min_sample_count: f32, max_sample_count: f32) -> vec3<f32> {
	// Compute next intersection with atmosphere or ground
	let planet_center = vec3<f32>();
    var t_max: f32 = 0.0;
    if !find_atmosphere_t_max(&t_max, world_pos, world_dir, planet_center, atmosphere.bottom_radius, atmosphere.top_radius) {
        return vec3<f32>();
    }
	t_max = min(t_max, t_max_max);

	// Sample count
	let sample_count = mix(min_sample_count, max_sample_count, saturate(t_max * 0.01));
	let sample_count_floored = floor(sample_count);
	let t_max_floored = t_max * sample_count_floored / sample_count;	// rescale tMax to map to the last entire step segment.
	let sample_segment_t = 0.3;

	// Phase functions
	let cos_theta = dot(sun_dir, world_dir);
	let mie_phase_val = cornette_shanks_phase(atmosphere.mie_phase_g, -cos_theta);	// negate cosTheta because due to world_dir being a "in" direction.
	let rayleigh_phase_val = rayleigh_phase(cos_theta);

	var luminance = vec3(0.0);
	var throughput = vec3(1.0);
	var t = 0.0;
	var dt = t_max / sample_count;
	for (var s: f32 = 0.0; s < sample_count; s += 1.0) {
        // More expensive but artefact free
        var t0 = s / sample_count_floored;
        var t1 = (s + 1.0) / sample_count_floored;
        // Non linear distribution of sample within the range.
        t0 = t0 * t0;
        t1 = t1 * t1;
        // Make t0 and t1 world space distances.
        t0 = t_max_floored * t0;
        if t1 > 1.0 {
            t1 = t_max;
        } else {
            t1 = t_max_floored * t1;
        }
        t = t0 + (t1 - t0) * sample_segment_t;
        dt = t1 - t0;

		let sample_pos = world_pos + t * world_dir;
	    let sample_height = length(sample_pos);

		let zenith = sample_pos / sample_height;
		let cos_sun_zenith = dot(sun_dir, zenith);
		let uv = transmittance_lut_params_to_uv(atmosphere, sample_height, cos_sun_zenith);
		let transmittance_to_sun = textureSampleLevel(transmittance_lut, lut_sampler, uv, 0).rgb;

		let medium = sample_medium(sample_height - atmosphere.bottom_radius, atmosphere);
		let sample_transmittance = exp(-medium.extinction * dt);

        let earth_shadow = compute_earth_shadow(sample_pos, sun_dir, planet_center + planet_radius_offset * zenith, atmosphere.bottom_radius);

		let phase_times_scattering = medium.mie_scattering * mie_phase_val + medium.rayleigh_scattering * rayleigh_phase_val;
		
		let multi_scattered_luminance = get_multiple_scattering(atmosphere, medium.scattering, medium.extinction, sample_pos, cos_sun_zenith);

		let scattering = sun_illuminance * (earth_shadow * transmittance_to_sun * phase_times_scattering + multi_scattered_luminance * medium.scattering);

        let scattering_int = (scattering - scattering * sample_transmittance) / medium.extinction;	// integrate along the current step segment
        luminance += throughput * scattering_int;														// accumulate and also take into account the transmittance from previous steps
        throughput *= sample_transmittance;
	}
	
	return luminance;
}

fn compute_sun_dir(sun_dir: vec3<f32>, zenith: vec3<f32>) -> vec3<f32> {
    let cos_sun_zenith = dot(zenith, sun_dir);
    return normalize(vec3(sqrt(1.0 - cos_sun_zenith * cos_sun_zenith), 0.0, cos_sun_zenith));
}

fn compute_world_dir(uv_in: vec2<f32>, sky_view_res: vec2<f32>, view_height: f32, atmosphere: Atmosphere) -> vec3<f32> {
	// Constrain uvs to valid sub texel range (avoid zenith derivative issue making LUT usage visible)
	let uv = vec2(from_sub_uvs_to_unit(uv_in.x, sky_view_res.x), from_sub_uvs_to_unit(uv_in.y, sky_view_res.y));

	let v_horizon = sqrt(view_height * view_height - atmosphere.bottom_radius * atmosphere.bottom_radius);
	//let v_horizon = sqrt(view_height * view_height - 6360.0 * 6360.0);
    let ground_to_horizon_angle = acos(v_horizon / view_height);
	let zenith_horizon_angle = pi - ground_to_horizon_angle;

    var cos_view_zenith: f32;
	if uv.y < 0.5 {
		let coord = 1.0 - (2.0 * uv.y);
		cos_view_zenith = cos(zenith_horizon_angle * (1.0 - (coord * coord)));
	} else {
		let coord = (uv.y * 2.0) - 1.0;
		cos_view_zenith = cos(zenith_horizon_angle + ground_to_horizon_angle * (coord * coord));
	}
	let cos_light_view = -((uv.x * uv.x) * 2.0 - 1.0);
	let sin_view_zenith: f32 = sqrt(1 - cos_view_zenith * cos_view_zenith);

    return vec3(
        sin_view_zenith * cos_light_view,
        sin_view_zenith * sqrt(1.0 - cos_light_view * cos_light_view),
        cos_view_zenith
    );
}

fn move_to_atmosphere_top(world_pos: ptr<function, vec3<f32>>, world_dir: vec3<f32>, top_radius: f32) -> bool {
	let view_height = length(*world_pos);
	if view_height > top_radius {
		let t_top = find_closest_ray_sphere_intersection(*world_pos, world_dir, vec3(), top_radius);
		if t_top >= 0.0 {
			let zenith = *world_pos / view_height;
			let zenith_offset = zenith * -planet_radius_offset;
			*world_pos = *world_pos + world_dir * t_top + zenith_offset;
		} else {
			// Ray is not intersecting the atmosphere
			return false;
		}
	}
	return true; // ok to start tracing
}

fn to_z_up_left_handed(v: vec3<f32>) -> vec3<f32> {
    if IS_Y_UP {
        if IS_RIGHT_HANDED {
            return vec3<f32>(v.x, v.z, v.y);
        } else {
            return vec3<f32>(v.x, -v.z, v.y);
        }
    } else {
        if IS_RIGHT_HANDED {
            return vec3<f32>(v.x, -v.y, v.z);
        } else {
            return v;
        }
    }
}

@compute
@workgroup_size(WORKGROUP_SIZE_X, WORKGROUP_SIZE_Y, 1)
fn render_sky_view_lut(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let output_size = vec2<u32>(textureDimensions(sky_view_lut));
    if output_size.x <= global_id.x || output_size.y <= global_id.y {
        return;
    }

    let sky_view_lut_res = vec2<f32>(SKY_VIEW_LUT_RES_X, SKY_VIEW_LUT_RES_Y); // vec2<f32>(output_size); <- tex dimensions produce artefacts!

    let pix = vec2<f32>(global_id.xy) + 0.5;
	let uv = pix / sky_view_lut_res;

	let atmosphere = atmosphere_buffer;
    let config = config_buffer;
	
	let min_sample_count = config_buffer.ray_march_min_spp;
	let max_sample_count = config_buffer.ray_march_max_spp;
	let sun_illuminance = config_buffer.sun_illuminance;

	let view_world_pos = to_z_up_left_handed(config_buffer.camera_world_position) + vec3(0.0, 0.0, atmosphere.bottom_radius);
	let world_sun_dir = to_z_up_left_handed(normalize(config_buffer.sun_direction));

	let view_height = length(view_world_pos);

    let zenith = view_world_pos / view_height;
    let sun_dir = compute_sun_dir(world_sun_dir, zenith);

	var world_pos = vec3<f32>(0.0, 0.0, view_height);
	let world_dir = compute_world_dir(uv, sky_view_lut_res, view_height, atmosphere);

	if !move_to_atmosphere_top(&world_pos, world_dir, atmosphere.top_radius) {
		textureStore(sky_view_lut, global_id.xy, vec4<f32>(0, 0, 0, 1));
        return;
	}

	let luminance = integrate_scattered_luminance(pix, world_pos, world_dir, sun_dir, atmosphere, sun_illuminance, min_sample_count, max_sample_count);

    textureStore(sky_view_lut, global_id.xy, vec4<f32>(luminance, 1));
}
