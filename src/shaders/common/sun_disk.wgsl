override RENDER_SUN_DISK: bool = true;
override RENDER_MOON_DISK: bool = true;

fn limb_darkeining_factor(center_to_edge: f32) -> vec3<f32> {
    let u = vec3<f32>(1.0);
    let a = vec3<f32>(0.397 , 0.503 , 0.652);
    let inv_center_to_edge = 1.0 - center_to_edge;
    let mu = sqrt(max(1.0 - inv_center_to_edge * inv_center_to_edge, 0.0));
    return 1.0 - u * (1.0 - pow(vec3<f32>(mu), a));
}

fn sun_disk_luminance(world_pos: vec3<f32>, world_dir: vec3<f32>, atmosphere: Atmosphere, light: AtmosphereLight) -> vec3<f32> {
    let cos_view_sun = dot(world_dir, light.direction);
    let cos_disk_radius = cos(0.5 * light.disk_diameter);
    
    if cos_view_sun <= cos_disk_radius || ray_intersects_sphere(world_pos, world_dir, vec3<f32>(), atmosphere.bottom_radius) {
        return vec3<f32>();
    }

    let height = length(world_pos);

    let e_zenith = light.disk_luminance;
    let disk_solid_angle = tau * cos_disk_radius;
    let l_zenith = e_zenith / disk_solid_angle;
    let transmittance_zenith = textureLoad(transmittance_lut, vec2(0, 0), 0).rgb;
    let l_outer_space = l_zenith / transmittance_zenith;

    let zenith = world_pos / height;
    let cos_view_zenith = dot(world_dir, zenith);
    let uv = transmittance_lut_params_to_uv(atmosphere, height, cos_view_zenith);
    let transmittance_sun = textureSampleLevel(transmittance_lut, lut_sampler, uv, 0).rgb;

    let center_to_edge = (cos_view_sun - cos_disk_radius) / (1.0 - cos_disk_radius);

    return transmittance_sun * l_outer_space * limb_darkeining_factor(center_to_edge);
}

fn get_sun_luminance(world_pos: vec3<f32>, world_dir: vec3<f32>, atmosphere: Atmosphere, uniforms: Uniforms) -> vec3<f32> {
    var sun_luminance = vec3<f32>();
    if RENDER_SUN_DISK {
        sun_luminance += sun_disk_luminance(world_pos, world_dir, atmosphere, uniforms.sun);
    }
    if RENDER_MOON_DISK && USE_MOON {
        sun_luminance += sun_disk_luminance(world_pos, world_dir, atmosphere, uniforms.moon);
    }
	return sun_luminance;
}
