override SKY_VIEW_LUT_RES_X: f32 = 192.0;
override SKY_VIEW_LUT_RES_Y: f32 = 108.0;

override INV_DISTANCE_TO_MAX_SAMPLE_COUNT: f32 = 1.0 / 100.0;

override USE_MOON: bool = false;

override WORKGROUP_SIZE_X: u32 = 16;
override WORKGROUP_SIZE_Y: u32 = 16;

@group(0) @binding(0) var<uniform> atmosphere_buffer: Atmosphere;
@group(0) @binding(1) var<uniform> config_buffer: Uniforms;
@group(0) @binding(2) var lut_sampler: sampler;
@group(0) @binding(3) var transmittance_lut: texture_2d<f32>;
@group(0) @binding(4) var multi_scattering_lut: texture_2d<f32>;
@group(0) @binding(5) var sky_view_lut : texture_storage_2d<rgba16float, write>;

struct SingleScatteringResult {
	luminance: vec3<f32>,				// Scattered light (luminance)
	transmittance: vec3<f32>,			// transmittance in [0,1] (unitless)
}

fn integrate_scattered_luminance(world_pos: vec3<f32>, world_dir: vec3<f32>, sun_dir: vec3<f32>, moon_dir: vec3<f32>, atmosphere: Atmosphere, config: Uniforms) -> SingleScatteringResult {
	var result = SingleScatteringResult();
	
	let planet_center = vec3<f32>();
    var t_max: f32 = 0.0;
    if !find_atmosphere_t_max(&t_max, world_pos, world_dir, planet_center, atmosphere.bottom_radius, atmosphere.top_radius) {
        return result;
    }
	t_max = min(t_max, t_max_max);

	// Sample count
	let sample_count = mix(config.ray_march_min_spp, config.ray_march_max_spp, saturate(t_max * INV_DISTANCE_TO_MAX_SAMPLE_COUNT));
	let sample_count_floored = floor(sample_count);
	let t_max_floored = t_max * sample_count_floored / sample_count;
	let sample_segment_t = 0.3;

	let sun_illuminance = config.sun.illuminance;
	let moon_illuminance = config.moon.illuminance;

	// Phase functions
	let cos_theta = dot(sun_dir, world_dir);
	let mie_phase_val = cornette_shanks_phase(atmosphere.mie_phase_g, -cos_theta);	// negate cosTheta because due to world_dir being a "in" direction.
	let rayleigh_phase_val = rayleigh_phase(cos_theta);

    let cos_theta_moon = dot(moon_dir, world_dir);
    let mie_phase_val_moon = cornette_shanks_phase(atmosphere.mie_phase_g, -cos_theta_moon);
    let rayleigh_phase_val_moon = rayleigh_phase(cos_theta_moon);

	result.luminance = vec3(0.0);
	result.transmittance = vec3(1.0);
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

		let medium = sample_medium(sample_height - atmosphere.bottom_radius, atmosphere);
		let sample_transmittance = exp(-medium.extinction * dt);

		let zenith = sample_pos / sample_height;
		let cos_sun_zenith = dot(sun_dir, zenith);
		let uv = transmittance_lut_params_to_uv(atmosphere, sample_height, cos_sun_zenith);
		let transmittance_to_sun = textureSampleLevel(transmittance_lut, lut_sampler, uv, 0).rgb;

        let planet_shadow = compute_planet_shadow(sample_pos, sun_dir, planet_center + planet_radius_offset * zenith, atmosphere.bottom_radius);

		let phase_times_scattering = medium.mie_scattering * mie_phase_val + medium.rayleigh_scattering * rayleigh_phase_val;
		
		let multi_scattered_luminance = get_multiple_scattering(atmosphere, medium.scattering, medium.extinction, sample_pos, cos_sun_zenith);

		var scattering = sun_illuminance * (planet_shadow * transmittance_to_sun * phase_times_scattering + multi_scattered_luminance * medium.scattering);

		if USE_MOON {
            let cos_moon_zenith = dot(moon_dir, zenith);
            let transmittance_to_moon = textureSampleLevel(transmittance_lut, lut_sampler, transmittance_lut_params_to_uv(atmosphere, sample_height, cos_moon_zenith), 0).rgb;
            let planet_shadow_moon = compute_planet_shadow(sample_pos, moon_dir, planet_center + planet_radius_offset * zenith, atmosphere.bottom_radius);
            let phase_times_scattering_moon = medium.mie_scattering * mie_phase_val_moon + medium.rayleigh_scattering * rayleigh_phase_val_moon;
            let multi_scattered_luminance_moon = get_multiple_scattering(atmosphere, medium.scattering, medium.extinction, sample_pos, cos_moon_zenith);

            scattering += moon_illuminance * (planet_shadow_moon * transmittance_to_moon * phase_times_scattering_moon + multi_scattered_luminance_moon * medium.scattering);
        }

        let scattering_int = (scattering - scattering * sample_transmittance) / medium.extinction;	// integrate along the current step segment
        result.luminance += result.transmittance * scattering_int;														// accumulate and also take into account the transmittance from previous steps
        result.transmittance *= sample_transmittance;
	}
	
	return result;
}

fn compute_sun_dir(sun_dir: vec3<f32>, zenith: vec3<f32>) -> vec3<f32> {
    let cos_sun_zenith = dot(zenith, sun_dir);
    return normalize(vec3(sqrt(max(1.0 - cos_sun_zenith * cos_sun_zenith, 0.0)), 0.0, cos_sun_zenith));
}

fn compute_world_dir(uv_in: vec2<f32>, sky_view_res: vec2<f32>, view_height: f32, atmosphere: Atmosphere) -> vec3<f32> {
	// Constrain uvs to valid sub texel range (avoid zenith derivative issue making LUT usage visible)
	let uv = vec2(from_sub_uvs_to_unit(uv_in.x, sky_view_res.x), from_sub_uvs_to_unit(uv_in.y, sky_view_res.y));

	let v_horizon = sqrt(max(view_height * view_height - atmosphere.bottom_radius * atmosphere.bottom_radius, 0.0));
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
	let sin_view_zenith = sqrt(max(1.0 - cos_view_zenith * cos_view_zenith, 0.0));

    return vec3(
        sin_view_zenith * cos_light_view,
        sin_view_zenith * sqrt(max(1.0 - cos_light_view * cos_light_view, 0.0)),
        cos_view_zenith
    );
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

	let view_world_pos = config.camera_world_position - atmosphere.planet_center;
	let world_sun_dir = normalize(config.sun.direction);
	let world_moon_dir = normalize(config.moon.direction);

	let view_height = length(view_world_pos);

    let zenith = view_world_pos / view_height;
    let sun_dir = compute_sun_dir(world_sun_dir, zenith);
    let moon_dir = compute_sun_dir(world_moon_dir, zenith);

	var world_pos = vec3<f32>(0.0, 0.0, view_height);
	let world_dir = compute_world_dir(uv, sky_view_lut_res, view_height, atmosphere);

	if !move_to_atmosphere_top(&world_pos, world_dir, atmosphere.top_radius) {
		textureStore(sky_view_lut, global_id.xy, vec4<f32>(0, 0, 0, 1));
        return;
	}

	let ss = integrate_scattered_luminance(world_pos, world_dir, sun_dir, moon_dir, atmosphere, config);

    textureStore(sky_view_lut, global_id.xy, vec4<f32>(ss.luminance, 1.0 - dot(ss.transmittance, vec3(1.0 / 3.0))));
}
