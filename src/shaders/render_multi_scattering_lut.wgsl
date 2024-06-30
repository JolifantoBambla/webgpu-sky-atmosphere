override SAMPLE_COUNT: u32 = 20; // a minimum set of step is required for accuracy unfortunately

// todo: multiscattering_factor as uniform?
override MULTI_SCATTERING_FACTOR: f32 = 1.0;

@group(0) @binding(0) var<uniform> atmosphere_buffer: Atmosphere;
@group(0) @binding(1) var lut_sampler: sampler;
@group(0) @binding(2) var transmittance_lut: texture_2d<f32>;
@group(0) @binding(3) var multi_scattering_lut: texture_storage_2d<rgba16float, write>;

const sqrt_direction_sample_count: u32 = 8;
const sqrt_direction_sample_count_f: f32 = f32(sqrt_direction_sample_count);
const workgroup_size_z: u32 = sqrt_direction_sample_count * sqrt_direction_sample_count;
const direction_sample_count_f: f32 = f32(workgroup_size_z);

var<workgroup> shared_multi_scattering: array<vec3<f32>, workgroup_size_z>;
var<workgroup> shared_luminance: array<vec3<f32>, workgroup_size_z>;

fn get_transmittance_to_sun(sun_dir: vec3<f32>, zenith: vec3<f32>, atmosphere: Atmosphere, sample_height: f32) -> vec3<f32> {
    let cos_sun_zenith = dot(sun_dir, zenith);
    let uv = transmittance_lut_params_to_uv(atmosphere, sample_height, cos_sun_zenith);
    return textureSampleLevel(transmittance_lut, lut_sampler, uv, 0).rgb;
}

struct IntegrationResults {
	luminance: vec3<f32>,
	multi_scattering: vec3<f32>,
}

fn integrate_scattered_luminance(world_pos: vec3<f32>, world_dir: vec3<f32>, sun_dir: vec3<f32>, atmosphere: Atmosphere) -> IntegrationResults {
	var result = IntegrationResults();

	let planet_center = vec3<f32>();
	var t_max: f32 = 0.0;
	var t_bottom: f32 = 0.0;
	if !find_atmosphere_t_max_t_bottom(&t_max, &t_bottom, world_pos, world_dir, planet_center, atmosphere.bottom_radius, atmosphere.top_radius) {
	    return result;
	}
	t_max = min(t_max, t_max_max);

	let sample_count = f32(SAMPLE_COUNT);
    let sample_segment_t = 0.3;
    let dt = t_max / sample_count;

	var throughput = vec3<f32>(1.0);
	var t = 0.0;
	var dt_exact = 0.0;
	for (var s: f32 = 0.0; s < sample_count; s += 1.0) {
        let t_new = (s + sample_segment_t) * dt;
        dt_exact = t_new - t;
        t = t_new;

		let sample_pos = world_pos + t * world_dir;
		let sample_height = length(sample_pos);

		let zenith = sample_pos / sample_height;
		let transmittance_to_sun = get_transmittance_to_sun(sun_dir, zenith, atmosphere, sample_height);

		let medium = sample_medium(sample_height - atmosphere.bottom_radius, atmosphere);
		let sample_transmittance = exp(-medium.extinction * dt_exact);

		let planet_shadow = compute_planet_shadow(sample_pos, sun_dir, planet_center + planet_radius_offset * zenith, atmosphere.bottom_radius);
        let scat = planet_shadow * transmittance_to_sun * (medium.scattering * isotropic_phase);

        result.multi_scattering += throughput * (medium.scattering - medium.scattering * sample_transmittance) / medium.extinction;
        result.luminance += throughput * (scat - scat * sample_transmittance) / medium.extinction;

        throughput *= sample_transmittance;
	}

    // Account for bounced light off the earth
	if t_max == t_bottom && t_bottom > 0.0 {
		let t = t_bottom;
		let sample_pos = world_pos + t * world_dir;
		let sample_height = length(sample_pos);

		let zenith = sample_pos / sample_height;
        let transmittance_to_sun = get_transmittance_to_sun(sun_dir, zenith, atmosphere, sample_height);

		let n_dot_l = saturate(dot(normalize(zenith), normalize(sun_dir)));
		result.luminance += transmittance_to_sun * throughput * n_dot_l * atmosphere.ground_albedo / pi;
	}

	return result;
}

fn compute_sample_direction(direction_index: u32) -> vec3<f32> {
	let i = (0.5 + f32(direction_index / sqrt_direction_sample_count)) / sqrt_direction_sample_count_f;
	let j = (0.5 + f32(direction_index - ((direction_index / sqrt_direction_sample_count) * sqrt_direction_sample_count))) / sqrt_direction_sample_count_f;
	let theta = 2.0 * pi * i;
    let phi = acos(1.0 - 2.0 * j);	// uniform distribution https://mathworld.wolfram.com/SpherePointPicking.html
    let cosPhi = cos(phi);
    let sinPhi = sin(phi);
    let cosTheta = cos(theta);
    let sinTheta = sin(theta);
    return vec3(
        cosTheta * sinPhi,
        sinTheta * sinPhi,
        cosPhi
    );
}

@compute
@workgroup_size(1, 1, workgroup_size_z)
fn render_multi_scattering_lut(@builtin(global_invocation_id) global_id: vec3<u32>) {
	let output_size = textureDimensions(multi_scattering_lut);
	let direction_index = global_id.z;

	let pix = vec2<f32>(global_id.xy) + 0.5;
	var uv = pix / vec2<f32>(output_size);
	uv = vec2<f32>(from_sub_uvs_to_unit(uv.x, f32(output_size.x)), from_sub_uvs_to_unit(uv.y, f32(output_size.y)));

	let atmosphere = atmosphere_buffer;

	let cos_sun_zenith = uv.x * 2.0 - 1.0;
	let sun_dir = vec3<f32>(0.0, sqrt(saturate(1.0 - cos_sun_zenith * cos_sun_zenith)), cos_sun_zenith);
	// view_height is offset by planet_radius_offset to be in a valid range.
	let view_height = atmosphere.bottom_radius + saturate(uv.y + planet_radius_offset) * (atmosphere.top_radius - atmosphere.bottom_radius - planet_radius_offset);

	let world_pos = vec3<f32>(0.0, 0.0, view_height);
	let world_dir = compute_sample_direction(direction_index);

    let scattering_result = integrate_scattered_luminance(world_pos, world_dir, sun_dir, atmosphere);

    shared_multi_scattering[direction_index] = scattering_result.multi_scattering * sphere_solid_angle / direction_sample_count_f;
    shared_luminance[direction_index] = scattering_result.luminance * sphere_solid_angle / direction_sample_count_f;

	workgroupBarrier();

    // reduce samples - the last remaining thread publishes the result
    for (var i = 32u; i > 0; i = i >> 1) {
        if direction_index < i {
            shared_multi_scattering[direction_index] += shared_multi_scattering[direction_index + i];
            shared_luminance[direction_index] += shared_luminance[direction_index + i];
        }
    	workgroupBarrier();
    }
	if direction_index > 0 {
		return;
    }

	let inscattered_luminance = shared_luminance[0] * isotropic_phase;
    
    let r = shared_multi_scattering[0] * isotropic_phase;
    let sum_of_multi_scattering_contributions = 1.0 / (1.0 - r);

    let luminance = inscattered_luminance * sum_of_multi_scattering_contributions;

    textureStore(multi_scattering_lut, global_id.xy, vec4<f32>(MULTI_SCATTERING_FACTOR * luminance, 1.0));
}

