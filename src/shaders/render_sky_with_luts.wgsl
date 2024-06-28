// todo: add sun disk config to params
override RENDER_SUN_DISK: bool = true;

override SKY_VIEW_LUT_RES_X: f32 = 192.0;
override SKY_VIEW_LUT_RES_Y: f32 = 108.0;

override WORKGROUP_SIZE_X: u32 = 16;
override WORKGROUP_SIZE_Y: u32 = 16;

override AP_SLICE_COUNT: f32 = 32.0;
override AP_KM_PER_SLICE: f32 = 4.0;

fn aerial_perspective_depth_to_slice(depth: f32) -> f32 {
	return depth * (1.0 / AP_KM_PER_SLICE);
}
fn aerial_perspective_slice_to_depth(slice: f32) -> f32 {
	return slice * AP_KM_PER_SLICE;
}


@group(0) @binding(0) var<uniform> atmosphere_buffer: Atmosphere;
@group(0) @binding(1) var<uniform> config_buffer: Config;

@group(1) @binding(0) var lut_sampler: sampler;

@group(2) @binding(0) var sky_view_lut: texture_2d<f32>;
@group(2) @binding(1) var aerial_perspective_lut : texture_3d<f32>;

// group 3 is passed in and contains only resources controlled by the user (except for render target? let's see what makes sense)
// todo: might be a depth texture
@group(3) @binding(0) var depth_buffer: texture_2d<f32>;
@group(3) @binding(1) var backbuffer : texture_2d<f32>;
@group(3) @binding(2) var render_target : texture_storage_2d<rgba16float, write>;

fn uv_and_depth_to_world_pos(inverse_view_projection: mat4x4<f32>, uv: vec2<f32>, depth: f32) -> vec3<f32> {
    let clip_pos = vec3(uv * vec2(2.0, -2.0) - vec2(1.0, -1.0), depth);
    let world_pos = inverse_view_projection * vec4(clip_pos, 1.0);
    return to_z_up_left_handed(world_pos.xyz / world_pos.w);
}

fn sky_view_lut_params_to_uv(atmosphere: Atmosphere, intersects_ground: bool, cos_view_zenith: f32, cos_light_view: f32, view_height: f32) -> vec2<f32> {
	let v_horizon = sqrt(max(view_height * view_height - atmosphere.bottom_radius * atmosphere.bottom_radius, 0.0));
	let ground_to_horizon = acos(v_horizon / view_height);
	let zenith_horizon_angle = pi - ground_to_horizon;

    var uv = vec2<f32>();
	if !intersects_ground {
		let coord = 1.0 - sqrt(max(1.0 - acos(cos_view_zenith) / zenith_horizon_angle, 0.0));
		uv.y = coord * 0.5;
	} else {
		let coord = (acos(cos_view_zenith) - zenith_horizon_angle) / ground_to_horizon;
		uv.y = sqrt(max(coord, 0.0)) * 0.5 + 0.5;
	}
    uv.x = sqrt(-cos_light_view * 0.5 + 0.5);

	return vec2(from_unit_to_sub_uvs(uv.x, SKY_VIEW_LUT_RES_X), from_unit_to_sub_uvs(uv.y, SKY_VIEW_LUT_RES_Y));
}

fn get_sun_luminance(world_pos: vec3<f32>, world_dir: vec3<f32>, sun_dir: vec3<f32>, planet_radius: f32) -> vec3<f32> {
    if RENDER_SUN_DISK {
        // todo: get rid of of this hard coded value
        if dot(world_dir, sun_dir) > cos(0.5 * 0.505 * 3.14159 / 180.0) {
            if !ray_intersects_sphere(world_pos, world_dir, vec3<f32>(), planet_radius) { // no intersection
                // todo: get rid of of this hard coded value
                return vec3<f32>(1000000.0);
            }
        }
	}
	return vec3<f32>();
}

fn blend(pix: vec2<u32>, src: vec4<f32>) {
    let dst = textureLoad(backbuffer, pix, 0);
    // blend op:        src*1 + dst * (1.0 - srcA)
    // alpha blend op:  src*0 + dst * (1.0 - srcA)
    let rgba = vec4<f32>(src.rgb, 0.0) + dst * (1.0 - clamp(src.a, 0.0, 1.0));
    textureStore(render_target, pix, rgba);
}

// todo: add a frament shader variant (which assumes the correct blend mode on the pipeline)

@compute
@workgroup_size(WORKGROUP_SIZE_X, WORKGROUP_SIZE_Y, 1)
fn render_sky_atmosphere(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let output_size = vec2<u32>(textureDimensions(render_target));
    if output_size.x <= global_id.x || output_size.y <= global_id.y {
        return;
    }

	let pix = vec2<f32>(global_id.xy) + 0.5;
	let uv = pix / vec2<f32>(textureDimensions(render_target).xy);

	let atmosphere = atmosphere_buffer;
    let config = config_buffer;

    let world_dir = uv_to_world_dir(uv, config.inverse_projection, config.inverse_view);
    var world_pos = to_z_up_left_handed(config.camera_world_position) + vec3(0.0, 0.0, atmosphere.bottom_radius);
    let sun_dir = to_z_up_left_handed(normalize(config.sun_direction));

	let view_height = length(world_pos);
	
    let depth = textureLoad(depth_buffer, global_id.xy, 0).r;
    if view_height < atmosphere.top_radius && !is_valid_depth(depth) {
        let zenith = normalize(world_pos);
        let cos_view_zenith = dot(world_dir, zenith);

        let side = normalize(cross(zenith, world_dir));	// assumes non parallel vectors
        let forward = normalize(cross(side, zenith));	// aligns toward the sun light but perpendicular to up vector
        let cos_light_view = normalize(vec2(dot(sun_dir, forward), dot(sun_dir, side))).x;

        let intersects_ground = ray_intersects_sphere(world_pos, world_dir, vec3(), atmosphere.bottom_radius);

        let uv = sky_view_lut_params_to_uv(atmosphere, intersects_ground, cos_view_zenith, cos_light_view, view_height);

        blend(global_id.xy, vec4(textureSampleLevel(sky_view_lut, lut_sampler, uv, 0).rgb + get_sun_luminance(world_pos, world_dir, sun_dir, atmosphere.bottom_radius), 1.0));
        return;
    }

    let depth_buffer_world_pos = uv_and_depth_to_world_pos(config.inverse_view * config.inverse_projection, uv, depth);

    let t_depth = length(depth_buffer_world_pos - (world_pos - vec3(0.0, 0.0, atmosphere.bottom_radius)));
    var slice = aerial_perspective_depth_to_slice(t_depth);
    var weight = 1.0;
    if slice < 0.5 {
        // We multiply by weight to fade to 0 at depth 0. That works for luminance and opacity.
        weight = saturate(slice * 2.0);
        slice = 0.5;
    }
    let w = sqrt(slice / AP_SLICE_COUNT);	// squared distribution

    blend(global_id.xy, weight * textureSampleLevel(aerial_perspective_lut, lut_sampler, vec3<f32>(uv, w), 0));
}

