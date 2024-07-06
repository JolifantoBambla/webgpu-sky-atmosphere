
override MULTI_SCATTERING_LUT_RES: f32 = 32.0;

override RANDOMIZE_SAMPLE_OFFSET: bool = true;

override WORKGROUP_SIZE_X: u32 = 16;
override WORKGROUP_SIZE_Y: u32 = 16;

@group(0) @binding(0) var<uniform> atmosphere_buffer: Atmosphere;
@group(0) @binding(1) var<uniform> config_buffer: Uniforms;
@group(0) @binding(2) var<storage> sky_lights: array<SkyLight>;
@group(0) @binding(3) var lut_sampler: sampler;
@group(0) @binding(4) var transmittance_lut: texture_2d<f32>;
@group(0) @binding(5) var multi_scattering_lut: texture_2d<f32>;
@group(0) @binding(6) var depth_buffer: texture_2d<f32>;
@group(0) @binding(7) var backbuffer: texture_2d<f32>;
@group(0) @binding(8) var render_target: texture_storage_2d<rgba16float, write>;

fn get_sample_shadow(atmosphere: Atmosphere, sample_position: vec3<f32>) -> f32 {
	return get_shadow(from_z_up(sample_position) + atmosphere.planet_center, 0);
}

struct SingleScatteringResult {
	luminance: vec3<f32>,				// Scattered light (luminance)
	transmittance: vec3<f32>,			// transmittance in [0,1] (unitless)
}

fn pcg_hash(seed: u32) -> u32 {
    let state = seed * 747796405u + 2891336453u;
    let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

fn pcg_hashf(seed: u32) -> f32 {
    return f32(pcg_hash(seed)) / 4294967296.0;
}

fn pcg_hash3(x: u32, y: u32, z: u32) -> f32 {
    return pcg_hashf((x * 1664525 + y) + z);
}

fn get_sample_segment_t(uv: vec2<f32>, config: Uniforms) -> f32 {
    if RANDOMIZE_SAMPLE_OFFSET {
        let seed = vec3<u32>(
            u32(uv.x * config.screen_resolution.x),
            u32(uv.y * config.screen_resolution.y),
            pcg_hash(u32(config.frame_id)),
        );
        return pcg_hash3(seed.x, seed.y, seed.z);
    } else {
        return 0.3;
    }
}

fn integrate_scattered_luminance(uv: vec2<f32>, world_pos: vec3<f32>, world_dir: vec3<f32>, sun_dir: vec3<f32>, atmosphere: Atmosphere, depth: f32, config: Uniforms) -> SingleScatteringResult {
	var result = SingleScatteringResult();

	let planet_center = vec3<f32>();
    var t_max: f32 = 0.0;
    if !find_atmosphere_t_max(&t_max, world_pos, world_dir, planet_center, atmosphere.bottom_radius, atmosphere.top_radius) {
        return result;
    }

    if is_valid_depth(depth) {
        let depth_buffer_world_pos = uv_and_depth_to_world_pos(config.inverse_view * config.inverse_projection, uv, depth);
        t_max = min(t_max, length(depth_buffer_world_pos - (world_pos + to_z_up(atmosphere.planet_center))));
    }
	t_max = min(t_max, t_max_max);

    let sample_count = mix(config.ray_march_min_spp, config.ray_march_max_spp, saturate(t_max * 0.01));
    let sample_count_floored = floor(sample_count);
    let t_max_floored = t_max * sample_count_floored / sample_count;
    let sample_segment_t = get_sample_segment_t(uv, config);

	// Phase functions
	let cos_theta = dot(sun_dir, world_dir);
	let mie_phase_val = cornette_shanks_phase(atmosphere.mie_phase_g, -cos_theta);
	let rayleigh_phase_val = rayleigh_phase(cos_theta);

	let sun_illuminance = sky_lights[0].illuminance;

	// Ray march the atmosphere to integrate optical depth
	result.transmittance = vec3(1.0);
	var t = 0.0;
	var dt = t_max / sample_count;
	for (var s: f32 = 0.0; s < sample_count; s += 1.0) {
        var t0: f32 = s / sample_count_floored;
        var t1: f32 = (s + 1.0) / sample_count_floored;
        t0 = t0 * t0;
        t1 = t1 * t1;
        t0 = t_max_floored * t0;
        if t1 > 1.0 {
            t1 = t_max;
        } else {
            t1 = t_max_floored * t1;
        }
        t = t0 + (t1 - t0) * sample_segment_t;
        dt = t1 - t0;

        let sample_pos = world_pos + t * world_dir;
        let sample_height= length(sample_pos);

		let zenith = sample_pos / sample_height;
		let cos_sun_zenith = dot(sun_dir, zenith);
		let uv = transmittance_lut_params_to_uv(atmosphere, sample_height, cos_sun_zenith);
		let transmittance_to_sun = textureSampleLevel(transmittance_lut, lut_sampler, uv, 0).rgb;

		let medium = sample_medium(sample_height - atmosphere.bottom_radius, atmosphere);
		let sample_transmittance = exp(-medium.extinction * dt);

		let planet_shadow = compute_planet_shadow(sample_pos, sun_dir, planet_center + planet_radius_offset * zenith, atmosphere.bottom_radius);

        let phase_times_scattering = medium.mie_scattering * mie_phase_val + medium.rayleigh_scattering * rayleigh_phase_val;

		let multi_scattered_luminance = get_multiple_scattering(atmosphere, medium.scattering, medium.extinction, sample_pos, cos_sun_zenith);

		let shadow = get_sample_shadow(atmosphere, sample_pos);

		let scattering = sun_illuminance * (planet_shadow * shadow * transmittance_to_sun * phase_times_scattering + multi_scattered_luminance * medium.scattering);

        let scattering_int = (scattering - scattering * sample_transmittance) / medium.extinction;
        result.luminance += result.transmittance * scattering_int;
        result.transmittance *= sample_transmittance;
	}

	return result;
}

struct RenderSkyResult {
    // todo: blend_src is not allowed without feature enabled - define type in extra file
    @location(0) /*@blend_src(0)*/ luminance: vec4<f32>,
    @location(1) /*@blend_src(1)*/ transmittance: vec4<f32>,
}

fn render_sky(pix: vec2<u32>) -> RenderSkyResult {
	let atmosphere = atmosphere_buffer;
    let config = config_buffer;

	let uv = (vec2<f32>(pix) + 0.5) / vec2<f32>(config.screen_resolution);

    let world_dir = uv_to_world_dir(uv, config.inverse_projection, config.inverse_view);
    var world_pos = to_z_up(config.camera_world_position - atmosphere.planet_center);
    let sun_dir = to_z_up(normalize(sky_lights[0].direction));

	let min_sample_count = config.ray_march_min_spp;
	let max_sample_count = config.ray_march_max_spp;

	let view_height: f32 = length(world_pos);
	
    var luminance = vec3<f32>();
	
    let depth = textureLoad(depth_buffer, pix, 0).r;
    if !is_valid_depth(depth) {
        luminance += get_sun_luminance(world_pos, world_dir, sun_dir, atmosphere.bottom_radius);
    }

    if !move_to_atmosphere_top(&world_pos, world_dir, atmosphere.top_radius) {
        luminance = get_sun_luminance(world_pos, world_dir, sun_dir, atmosphere.bottom_radius);
        return RenderSkyResult(max(vec4(luminance, 1.0), vec4()), max(vec4(0.0, 0.0, 0.0, 1.0), vec4()));
    }
    
    let ss = integrate_scattered_luminance(uv, world_pos, world_dir, sun_dir, atmosphere, depth, config);
    luminance += ss.luminance;

    return RenderSkyResult(max(vec4(luminance, 1.0), vec4()), max(vec4(ss.transmittance, 1.0), vec4()));
}

@fragment
fn fragment(@builtin(position) coord: vec4<f32>) -> RenderSkyResult {
    return render_sky(vec2<u32>(floor(coord.xy)));
}

@compute
@workgroup_size(WORKGROUP_SIZE_X, WORKGROUP_SIZE_Y)
fn render_sky_atmosphere(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let output_size = vec2<u32>(textureDimensions(render_target));
    if output_size.x <= global_id.x || output_size.y <= global_id.y {
        return;
    }
    let result = render_sky(global_id.xy);
    dual_source_blend(global_id.xy, result.luminance, result.transmittance);
}

