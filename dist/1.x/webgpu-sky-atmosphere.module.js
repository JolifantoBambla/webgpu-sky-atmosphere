/* webgpu-sky-atmosphere@1.1.0, license MIT */
/*
 * Copyright (c) 2024 Lukas Herzberger
 * Copyright (c) 2020 Epic Games, Inc.
 * SPDX-License-Identifier: MIT
 */
/**
 * Create a default atmosphere that corresponds to earth's atmosphere.
 *
 * @param center The center of the atmosphere. Defaults to `upDirection * -{@link Atmosphere.bottomRadius}` (`upDirection` depends on `yUp`).
 * @param yUp If true, the up direction for the default center will be `[0, 1, 0]`, otherwise `[0, 0, 1]` will be used.
 * @param useHenyeyGreenstein If this is true, {@link Mie.phaseParam} will be set to a value suitable for the Cornette-Shanks approximation (`0.8`), otherwise it is set to `3.4` for use with the Henyey-Greenstein + Draine approximation.
 *
 * @returns Atmosphere parameters corresponding to earth's atmosphere.
 */
function makeEarthAtmosphere(center, yUp = true, useHenyeyGreenstein = true) {
    const rayleighScaleHeight = 8.0;
    const mieScaleHeight = 1.2;
    const bottomRadius = 6360.0;
    return {
        center: center ?? [0.0, yUp ? -bottomRadius : 0.0, yUp ? 0.0 : -bottomRadius],
        bottomRadius,
        height: 100.0,
        rayleigh: {
            densityExpScale: -1.0 / rayleighScaleHeight,
            scattering: [0.005802, 0.013558, 0.033100],
        },
        mie: {
            densityExpScale: -1.0 / mieScaleHeight,
            scattering: [0.003996, 0.003996, 0.003996],
            extinction: [0.004440, 0.004440, 0.004440],
            phaseParam: useHenyeyGreenstein ? 0.8 : 3.4,
        },
        absorption: {
            layer0: {
                height: 25.0,
                constantTerm: -2.0 / 3.0,
                linearTerm: 1.0 / 15.0,
            },
            layer1: {
                constantTerm: 8.0 / 3.0,
                linearTerm: -1.0 / 15.0,
            },
            extinction: [0.000650, 0.001881, 0.000085],
        },
        groundAlbedo: [0.4, 0.4, 0.4],
        multipleScatteringFactor: 1.0,
    };
}

/*
 * Copyright (c) 2024 Lukas Herzberger
 * SPDX-License-Identifier: MIT
 */
/**
 * A helper class for textures.
 */
class LookUpTable {
    texture;
    view;
    constructor(texture) {
        this.texture = texture;
        this.view = texture.createView({
            label: texture.label,
        });
    }
}
/**
 * A helper class for compute passes
 */
class ComputePass {
    pipeline;
    bindGroups;
    dispatchDimensions;
    constructor(pipeline, bindGroups, dispatchDimensions) {
        this.pipeline = pipeline;
        this.bindGroups = bindGroups;
        this.dispatchDimensions = dispatchDimensions;
    }
    encode(computePassEncoder, resetBindGroups = false) {
        computePassEncoder.setPipeline(this.pipeline);
        for (let i = 0; i < this.bindGroups.length; ++i) {
            computePassEncoder.setBindGroup(i, this.bindGroups[i]);
        }
        computePassEncoder.dispatchWorkgroups(...this.dispatchDimensions);
        if (resetBindGroups) {
            for (let i = 0; i < this.bindGroups.length; ++i) {
                computePassEncoder.setBindGroup(i, null);
            }
        }
    }
    replaceBindGroup(index, bindGroup) {
        this.bindGroups[index] = bindGroup;
    }
    replaceDispatchDimensions(dispatchDimensions) {
        this.dispatchDimensions[0] = dispatchDimensions[0];
        this.dispatchDimensions[1] = dispatchDimensions[1];
        this.dispatchDimensions[2] = dispatchDimensions[2];
    }
}
/**
 * A helper class for render passes
 */
class RenderPass {
    pipeline;
    bindGroups;
    constructor(pipeline, bindGroups) {
        this.pipeline = pipeline;
        this.bindGroups = bindGroups;
    }
    encode(passEncoder, resetBindGroups = false) {
        passEncoder.setPipeline(this.pipeline);
        for (let i = 0; i < this.bindGroups.length; ++i) {
            passEncoder.setBindGroup(i, this.bindGroups[i]);
        }
        passEncoder.draw(3);
        if (resetBindGroups) {
            for (let i = 0; i < this.bindGroups.length; ++i) {
                passEncoder.setBindGroup(i, null);
            }
        }
    }
    replaceBindGroup(index, bindGroup) {
        this.bindGroups[index] = bindGroup;
    }
}
function makeLutSampler(device) {
    return device.createSampler({
        label: 'LUT sampler',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        addressModeW: 'clamp-to-edge',
        minFilter: 'linear',
        magFilter: 'linear',
        mipmapFilter: 'linear',
        lodMinClamp: 0,
        lodMaxClamp: 32,
        maxAnisotropy: 1,
    });
}

/*
 * Copyright (c) 2024 Lukas Herzberger
 * SPDX-License-Identifier: MIT
 */
const DEFAULT_TRANSMITTANCE_LUT_SIZE = [256, 64];
const DEFAULT_MULTISCATTERING_LUT_SIZE = 32;
const DEFAULT_SKY_VIEW_LUT_SIZE = [192, 108];
const DEFAULT_AERIAL_PERSPECTIVE_LUT_SIZE = [32, 32, 32];
const TRANSMITTANCE_LUT_FORMAT = 'rgba16float';
const MULTI_SCATTERING_LUT_FORMAT = TRANSMITTANCE_LUT_FORMAT;
const SKY_VIEW_LUT_FORMAT = TRANSMITTANCE_LUT_FORMAT;
const AERIAL_PERSPECTIVE_LUT_FORMAT = TRANSMITTANCE_LUT_FORMAT;
const ATMOSPHERE_BUFFER_SIZE = 128;
const UNIFORMS_BUFFER_SIZE = 224;
class SkyAtmosphereResources {
    /**
     * A name that is propagated to the WebGPU resources.
     */
    label;
    /**
     * The WebGPU device the resources are allocated from.
     */
    device;
    /**
     * A uniform buffer of size {@link ATMOSPHERE_BUFFER_SIZE} storing the {@link Atmosphere}'s parameters.
     */
    atmosphereBuffer;
    /**
     * A uniform buffer of size {@link UNIFORMS_BUFFER_SIZE} storing parameters set through {@link Uniforms}.
     *
     * If custom uniform buffers are used, this is undefined (see {@link CustomUniformsSourceConfig}).
     */
    uniformsBuffer;
    /**
     * A linear sampler used to sample the look up tables.
     */
    lutSampler;
    /**
     * The transmittance look up table.
     * Stores the medium transmittance toward the sun.
     *
     * Parameterized by the view / zenith angle in x and the altitude in y.
     */
    transmittanceLut;
    /**
     * The multiple scattering look up table.
     * Stores multiple scattering contribution.
     *
     * Paramterized by the sun / zenith angle in x (range: [π, 0]) and the altitude in y (range: [0, top], where top is the height of the atmosphere).
     */
    multiScatteringLut;
    /**
     * The sky view look up table.
     * Stores the distant sky around the camera with respect to it's altitude within the atmosphere.
     *
     * Parameterized by the longitude in x (range: [0, 2π]) and latitude in y (range: [-π/2, π/2]).
     */
    skyViewLut;
    /**
     * The aerial perspective look up table.
     * Stores the aerial perspective in a volume fit to the view frustum.
     *
     * Parameterized by x and y corresponding to the image plane and z being the view depth (range: [0, {@link AerialPerspectiveLutConfig.size}[2] * {@link AerialPerspectiveLutConfig.distancePerSlice}]).
     */
    aerialPerspectiveLut;
    /**
     * {@link Atmosphere} parameters.
     *
     * Set using {@link updateAtmosphere}.
     *
     * @see {@link updateAtmosphere}
     */
    #atmosphere;
    constructor(device, config, lutSampler) {
        this.label = config.label ?? 'atmosphere';
        this.device = device;
        this.#atmosphere = config.atmosphere ?? makeEarthAtmosphere();
        this.atmosphereBuffer = device.createBuffer({
            label: `atmosphere buffer [${this.label}]`,
            size: ATMOSPHERE_BUFFER_SIZE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.updateAtmosphere(this.#atmosphere);
        if (config.customUniformsSource) {
            this.uniformsBuffer = undefined;
        }
        else {
            this.uniformsBuffer = device.createBuffer({
                label: `config buffer [${this.label}]`,
                size: UNIFORMS_BUFFER_SIZE,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
        }
        this.lutSampler = lutSampler || makeLutSampler(device);
        this.transmittanceLut = new LookUpTable(device.createTexture({
            label: `transmittance LUT [${this.label}]`,
            size: config.lookUpTables?.transmittanceLut?.size ?? DEFAULT_TRANSMITTANCE_LUT_SIZE,
            format: config.lookUpTables?.transmittanceLut?.format ?? TRANSMITTANCE_LUT_FORMAT,
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
        }));
        this.multiScatteringLut = new LookUpTable(device.createTexture({
            label: `multi scattering LUT [${this.label}]`,
            size: config.lookUpTables?.multiScatteringLut?.size ?? [DEFAULT_MULTISCATTERING_LUT_SIZE, DEFAULT_MULTISCATTERING_LUT_SIZE],
            format: config.lookUpTables?.multiScatteringLut?.format ?? MULTI_SCATTERING_LUT_FORMAT,
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
        }));
        this.skyViewLut = new LookUpTable(device.createTexture({
            label: `sky view LUT [${this.label}]`,
            size: config.lookUpTables?.skyViewLut?.size ?? DEFAULT_SKY_VIEW_LUT_SIZE,
            format: config.lookUpTables?.skyViewLut?.format ?? SKY_VIEW_LUT_FORMAT,
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
        }));
        this.aerialPerspectiveLut = new LookUpTable(device.createTexture({
            label: `aerial perspective LUT [${this.label}]`,
            size: config.lookUpTables?.aerialPerspectiveLut?.size ?? DEFAULT_AERIAL_PERSPECTIVE_LUT_SIZE,
            format: config.lookUpTables?.aerialPerspectiveLut?.format ?? AERIAL_PERSPECTIVE_LUT_FORMAT,
            dimension: '3d',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
        }));
    }
    get atmosphere() {
        return this.#atmosphere;
    }
    /**
     * Updates the {@link SkyAtmosphereResources.atmosphereBuffer} using a given {@link Atmosphere}.
     *
     * Overwrites this instance's internal {@link Atmosphere} parameters.
     *
     * @param atmosphere the {@link Atmosphere} to write to the {@link atmosphereBuffer}.
     * @see atmosphereToFloatArray Internally call {@link atmosphereToFloatArray} to convert the {@link Atmosphere} to a `Float32Array`.
     */
    updateAtmosphere(atmosphere) {
        this.#atmosphere = atmosphere;
        this.device.queue.writeBuffer(this.atmosphereBuffer, 0, atmosphereToFloatArray(this.#atmosphere));
    }
    /**
     * Updates the {@link SkyAtmosphereResources.uniformsBuffer} using a given {@link Uniforms}.
     * @param uniforms the {@link Uniforms} to write to the {@link atmosphereBuffer}.
     * @see uniformsToFloatArray Internally call {@link uniformsToFloatArray} to convert the {@link Uniforms} to a `Float32Array`.
     */
    updateUniforms(uniforms) {
        if (this.uniformsBuffer) {
            this.device.queue.writeBuffer(this.uniformsBuffer, 0, uniformsToFloatArray(uniforms));
        }
    }
}
/**
 * Converts an {@link Atmosphere} to a tightly packed `Float32Array` of size {@link ATMOSPHERE_BUFFER_SIZE}.
 * @param atmosphere the {@link Atmosphere} to convert.
 * @returns a `Float32Array` containing the {@link Atmosphere} parameters.
 */
function atmosphereToFloatArray(atmosphere) {
    return new Float32Array([
        atmosphere.rayleigh.scattering[0],
        atmosphere.rayleigh.scattering[1],
        atmosphere.rayleigh.scattering[2],
        atmosphere.rayleigh.densityExpScale,
        atmosphere.mie.scattering[0],
        atmosphere.mie.scattering[1],
        atmosphere.mie.scattering[2],
        atmosphere.mie.densityExpScale,
        atmosphere.mie.extinction[0],
        atmosphere.mie.extinction[1],
        atmosphere.mie.extinction[2],
        atmosphere.mie.phaseParam,
        Math.max(atmosphere.mie.extinction[0] - atmosphere.mie.scattering[0], 0.0),
        Math.max(atmosphere.mie.extinction[1] - atmosphere.mie.scattering[1], 0.0),
        Math.max(atmosphere.mie.extinction[2] - atmosphere.mie.scattering[2], 0.0),
        atmosphere.absorption.layer0.height,
        atmosphere.absorption.layer0.constantTerm,
        atmosphere.absorption.layer0.linearTerm,
        atmosphere.absorption.layer1.constantTerm,
        atmosphere.absorption.layer1.linearTerm,
        atmosphere.absorption.extinction[0],
        atmosphere.absorption.extinction[1],
        atmosphere.absorption.extinction[2],
        atmosphere.bottomRadius,
        atmosphere.groundAlbedo[0],
        atmosphere.groundAlbedo[1],
        atmosphere.groundAlbedo[2],
        atmosphere.bottomRadius + Math.max(atmosphere.height, 0.0),
        ...atmosphere.center,
        atmosphere.multipleScatteringFactor,
    ]);
}
/**
 * Converts an {@link Uniforms} to a tightly packed `Float32Array` of size {@link UNIFORMS_BUFFER_SIZE}.
 * @param uniforms the {@link Uniforms} to convert.
 * @returns a `Float32Array` containing the {@link Uniforms} parameters.
 */
function uniformsToFloatArray(uniforms) {
    return new Float32Array([
        ...uniforms.camera.inverseProjection,
        ...uniforms.camera.inverseView,
        ...uniforms.camera.position,
        uniforms.frameId ?? 0.0,
        ...uniforms.screenResolution,
        uniforms.rayMarchMinSPP ?? 14.0,
        uniforms.rayMarchMaxSPP ?? 30.0,
        ...(uniforms.sun.illuminance ?? [1.0, 1.0, 1.0]),
        uniforms.sun.diskAngularDiameter ?? (0.545 * (Math.PI / 180.0)),
        ...uniforms.sun.direction,
        uniforms.sun.diskLuminanceScale ?? 1.0,
        ...(uniforms.moon?.illuminance ?? [1.0, 1.0, 1.0]),
        uniforms.moon?.diskAngularDiameter ?? (0.568 * Math.PI / 180.0),
        ...(uniforms.moon?.direction ?? uniforms.sun.direction.map(d => d * -1)),
        uniforms.moon?.diskLuminanceScale ?? 1.0,
    ]);
}

var aerialPerspectiveWgsl = "/*\n * Copyright (c) 2024 Lukas Herzberger\n * Copyright (c) 2020 Epic Games, Inc.\n * SPDX-License-Identifier: MIT\n */\n\noverride AP_SLICE_COUNT: f32 = 32.0;\noverride AP_DISTANCE_PER_SLICE: f32 = 4.0;\n\noverride AP_INV_DISTANCE_PER_SLICE: f32 = 1.0 / AP_DISTANCE_PER_SLICE;\n\nfn aerial_perspective_depth_to_slice(depth: f32) -> f32 {\n\treturn depth * AP_INV_DISTANCE_PER_SLICE;\n}\nfn aerial_perspective_slice_to_depth(slice: f32) -> f32 {\n\treturn slice * AP_DISTANCE_PER_SLICE;\n}\n";

var blendWgsl = "/*\n * Copyright (c) 2024 Lukas Herzberger\n * SPDX-License-Identifier: MIT\n */\n\nfn blend(pix: vec2<u32>, src: vec4<f32>) {\n\tlet dst = textureLoad(backbuffer, pix, 0);\n\t// blend op:        src*1 + dst * (1.0 - srcA)\n\t// alpha blend op:  src  * 0 + dst * 1\n\tlet rgb = src.rgb + dst.rgb * (1.0 - saturate(src.a));\n\tlet a = dst.a;\n\ttextureStore(render_target, pix, vec4<f32>(rgb, a));\n}\n\nfn dual_source_blend(pix: vec2<u32>, src0: vec4<f32>, src1: vec4<f32>) {\n\tlet dst = textureLoad(backbuffer, pix, 0);\n\t// blend op:        src0 * 1 + dst * src1\n\t// alpha blend op:  src  * 0 + dst * 1\n\tlet rgb = src0.rgb + dst.rgb * src1.rgb;\n\tlet a = dst.a;\n\ttextureStore(render_target, pix, vec4<f32>(rgb, a));\n}\n";

var constantsWgsl = "/*\n * Copyright (c) 2024 Lukas Herzberger\n * SPDX-License-Identifier: MIT\n */\n\nconst pi: f32 = radians(180.0);\nconst tau: f32 = pi * 2.0;\nconst golden_ratio: f32 = (1.0 + sqrt(5.0)) / 2.0;\n\nconst u32_max: f32 = 4294967296.0;\n\nconst sphere_solid_angle: f32 = 4.0 * pi;\n\nconst t_max_max: f32 = 9000000.0;\nconst planet_radius_offset: f32 = 0.01;\n\n";

var customUniformsWgsl = "/*\n * Copyright (c) 2024 Lukas Herzberger\n * SPDX-License-Identifier: MIT\n */\n\nfn get_uniforms() -> Uniforms {\n\tUniforms uniforms;\n\tuniforms.inverse_projection = get_inverse_projection();\n\tuniforms.inverse_view = get_inverse_view();\n\tuniforms.camera_world_position = get_camera_world_position();\n\tuniforms.frame_id = get_frame_id();\n\tuniforms.screen_resolution = get_screen_resolution();\n\tuniforms.ray_march_min_spp = get_ray_march_min_spp();\n\tuniforms.ray_march_max_spp = get_ray_march_max_spp();\n\tuniforms.sun.illuminance = get_sun_illuminance();\n\tuniforms.sun.direction = get_sun_direction();\n\tuniforms.sun.disk_diameter =  get_sun_disk_diameter();\n\tuniforms.sun.disk_luminance_scale = get_sun_disk_luminance_scale();\n\tuniforms.moon.illuminance = get_moon_illuminance();\n\tuniforms.moon.direction = get_moon_direction();\n\tuniforms.moon.disk_diameter =  get_moon_disk_diameter();\n\tuniforms.moon.disk_luminance_scale = get_moon_disk_luminance_scale();\n\treturn uniforms;\n}\n";

var coordinateSystemWgsl = "/*\n * Copyright (c) 2024 Lukas Herzberger\n * SPDX-License-Identifier: MIT\n */\n\noverride IS_REVERSE_Z: bool = true;\n\noverride FROM_KM_SCALE: f32 = 1.0;\noverride TO_KM_SCALE: f32 = 1.0 / FROM_KM_SCALE;\n\nfn depth_max() -> f32 {\n\tif IS_REVERSE_Z {\n\t\treturn 0.0000001;\n\t} else {\n\t\treturn 1.0;\n\t}\n}\n\nfn is_valid_depth(depth: f32) -> bool {\n\tif IS_REVERSE_Z {\n\t\treturn depth > 0.0 && depth <= 1.0;\n\t} else {\n\t\treturn depth < 1.0 && depth >= 0.0;\n\t}\n}\n\nfn uv_to_world_dir(uv: vec2<f32>, inv_proj: mat4x4<f32>, inv_view: mat4x4<f32>) -> vec3<f32> {\n\tlet hom_view_space = inv_proj * vec4<f32>(vec3<f32>(uv * vec2<f32>(2.0, -2.0) - vec2<f32>(1.0, -1.0), depth_max()), 1.0);\n\treturn normalize((inv_view * vec4<f32>(hom_view_space.xyz / hom_view_space.w, 0.0)).xyz);\n}\n\nfn uv_and_depth_to_world_pos(uv: vec2<f32>, inv_proj: mat4x4<f32>, inv_view: mat4x4<f32>, depth: f32) -> vec3<f32> {\n\tlet hom_view_space = inv_proj * vec4<f32>(vec3<f32>(uv * vec2<f32>(2.0, -2.0) - vec2<f32>(1.0, -1.0), depth), 1.0);\n\treturn (inv_view * vec4<f32>(hom_view_space.xyz / hom_view_space.w, 1.0)).xyz * TO_KM_SCALE;\n}\n";

var fullScreenVertexShaderWgsl = "/*\n * Copyright (c) 2024 Lukas Herzberger\n * SPDX-License-Identifier: MIT\n */\n\n@vertex\nfn vertex(@builtin(vertex_index) vertex_index: u32) -> @builtin(position) vec4<f32> {\n\treturn vec4<f32>(vec2<f32>(f32((vertex_index << 1) & 2), f32(vertex_index & 2)) * 2 - 1, 0, 1);\n}\n";

var hgDraineConstWgsl = "/*\n * Copyright (c) 2024 Lukas Herzberger\n * SPDX-License-Identifier: MIT\n */\n\noverride HG_DRAINE_ALPHA_THIRDS = HG_DRAINE_ALPHA / 3.0;\noverride HG_DRAINE_G_HG_2 = HG_DRAINE_G_HG * HG_DRAINE_G_HG;\noverride HG_DRAINE_G_D_2 = HG_DRAINE_G_D * HG_DRAINE_G_D;\noverride HG_DRAINE_CONST_DENOM = 1.0 / (1.0 + (HG_DRAINE_ALPHA * (1.0 / 3.0) * (1.0 + (2.0 * HG_DRAINE_G_D_2))));\n\nfn draine_phase_hg(cos_theta: f32) -> f32 {\n    return one_over_four_pi *\n        ((1.0 - HG_DRAINE_G_HG_2) / pow((1.0 + HG_DRAINE_G_HG_2 - (2.0 * HG_DRAINE_G_HG * cos_theta)), 1.5));\n}\n\nfn draine_phase_d(cos_theta: f32) -> f32 {\n    return one_over_four_pi *\n          ((1.0 - HG_DRAINE_G_D_2) / pow((1.0 + HG_DRAINE_G_D_2 - (2.0 * HG_DRAINE_G_D * cos_theta)), 1.5)) *\n          ((1.0 + (HG_DRAINE_ALPHA * cos_theta * cos_theta)) * HG_DRAINE_CONST_DENOM);\n}\n\nfn hg_draine_phase(cos_theta: f32) -> f32 {\n    return mix(draine_phase_hg(cos_theta), draine_phase_d(cos_theta), HG_DRAINE_W_D);\n}\n";

var hgDraineLargeWgsl = "/*\n * Copyright (c) 2024 Lukas Herzberger\n * SPDX-License-Identifier: MIT\n */\n\n// 5 µm ≤ 𝑑 ≤ 50 µm\noverride HG_DRAINE_G_HG = exp(-(0.0990567 / (HG_DRAINE_DROPLET_DIAMETER - 1.67154)));\noverride HG_DRAINE_G_D = exp(-(2.20679 / (HG_DRAINE_DROPLET_DIAMETER + 3.91029)) - 0.428934);\noverride HG_DRAINE_ALPHA = exp(3.62489 - (8.29288 / (HG_DRAINE_DROPLET_DIAMETER + 5.52825)));\noverride HG_DRAINE_W_D = exp(-(0.599085 / (HG_DRAINE_DROPLET_DIAMETER - 0.641583)) - 0.665888);\n";

var hgDraineMid2Wgsl = "/*\n * Copyright (c) 2024 Lukas Herzberger\n * SPDX-License-Identifier: MIT\n */\n\n// 1.5 µm <= 𝑑 < 5 µm\noverride HG_DRAINE_G_HG = 0.0604931 * log(log(HG_DRAINE_DROPLET_DIAMETER)) + 0.940256;\noverride HG_DRAINE_G_D = 0.500411 - 0.081287 / (-2.0 * log(HG_DRAINE_DROPLET_DIAMETER) + tan(log(HG_DRAINE_DROPLET_DIAMETER)) + 1.27551);\noverride HG_DRAINE_ALPHA = 7.30354 * log(HG_DRAINE_DROPLET_DIAMETER) + 6.31675;\noverride HG_DRAINE_W_D = 0.026914 * (log(HG_DRAINE_DROPLET_DIAMETER) - cos(5.68947 * (log(log(HG_DRAINE_DROPLET_DIAMETER)) - 0.0292149))) + 0.376475;\n";

var hgDraineMid1Wgsl = "/*\n * Copyright (c) 2024 Lukas Herzberger\n * SPDX-License-Identifier: MIT\n */\n\n// 0.1 µm < 𝑑 < 1.5 µm\noverride HG_DRAINE_G_HG = 0.862 - 0.143 * log(HG_DRAINE_DROPLET_DIAMETER) * log(HG_DRAINE_DROPLET_DIAMETER);\noverride HG_DRAINE_G_D = 0.379685 * cos(1.19692 * cos(((log(HG_DRAINE_DROPLET_DIAMETER) - 0.238604) * (log(HG_DRAINE_DROPLET_DIAMETER) + 1.00667)) / (0.507522 - 0.15677 * log(HG_DRAINE_DROPLET_DIAMETER))) + 1.37932 * log(HG_DRAINE_DROPLET_DIAMETER) + 0.0625835) + 0.344213;\noverride HG_DRAINE_ALPHA = 250.0;\noverride HG_DRAINE_W_D = 0.146209 * cos(3.38707 * log(HG_DRAINE_DROPLET_DIAMETER) + 2.11193) + 0.316072 + 0.0778917 * log(HG_DRAINE_DROPLET_DIAMETER);\n";

var hgDraineSmallWgsl = "/*\n * Copyright (c) 2024 Lukas Herzberger\n * SPDX-License-Identifier: MIT\n */\n\n// 𝑑 <= 0.1 µm\noverride HG_DRAINE_G_HG = 13.8 * HG_DRAINE_DROPLET_DIAMETER * HG_DRAINE_DROPLET_DIAMETER;\noverride HG_DRAINE_G_D = 1.1456 * HG_DRAINE_DROPLET_DIAMETER * sin(9.29044 * HG_DRAINE_DROPLET_DIAMETER);\noverride HG_DRAINE_ALPHA = 250.0;\noverride HG_DRAINE_W_D = 0.252977 - pow(312.983 * HG_DRAINE_DROPLET_DIAMETER, 4.3);\n";

var intersectionWgsl = "/*\n * Copyright (c) 2024 Lukas Herzberger\n * Copyright (c) 2020 Epic Games, Inc.\n * SPDX-License-Identifier: MIT\n */\n\n// If there are no positive real solutions, returns -1.0\nfn solve_quadratic_for_positive_reals(a: f32, b: f32, c: f32) -> f32 {\n\tlet delta = b * b - 4.0 * a * c;\n\tif delta < 0.0 || a == 0.0 {\n\t\treturn -1.0;\n\t}\n\tlet solution0 = (-b - sqrt(delta)) / (2.0 * a);\n\tlet solution1 = (-b + sqrt(delta)) / (2.0 * a);\n\tif solution0 < 0.0 && solution1 < 0.0 {\n\t\treturn -1.0;\n\t}\n\tif solution0 < 0.0 {\n\t\treturn max(0.0, solution1);\n\t}\n\telse if solution1 < 0.0 {\n\t\treturn max(0.0, solution0);\n\t}\n\treturn max(0.0, min(solution0, solution1));\n}\n\nfn quadratic_has_positive_real_solutions(a: f32, b: f32, c: f32) -> bool {\n\tlet delta = b * b - 4.0 * a * c;\n\treturn (delta >= 0.0 && a != 0.0) && (((-b - sqrt(delta)) / (2.0 * a)) >= 0.0 || ((-b + sqrt(delta)) / (2.0 * a)) >= 0.0);\n}\n\nfn find_closest_ray_sphere_intersection(o: vec3<f32>, d: vec3<f32>, c: vec3<f32>, r: f32) -> f32 {\n\tlet dist = o - c;\n\treturn solve_quadratic_for_positive_reals(dot(d, d), 2.0 * dot(d, dist), dot(dist, dist) - (r * r));\n}\n\nfn ray_intersects_sphere(o: vec3<f32>, d: vec3<f32>, c: vec3<f32>, r: f32) -> bool {\n\tlet dist = o - c;\n\treturn quadratic_has_positive_real_solutions(dot(d, d), 2.0 * dot(d, dist), dot(dist, dist) - (r * r));\n}\n\nfn compute_planet_shadow(o: vec3<f32>, d: vec3<f32>, c: vec3<f32>, r: f32) -> f32 {\n\treturn f32(!ray_intersects_sphere(o, d, c, r));\n}\n\nfn find_atmosphere_t_max(t_max: ptr<function, f32>, o: vec3<f32>, d: vec3<f32>, c: vec3<f32>, bottom_radius: f32, top_radius: f32) -> bool {\n\tlet t_bottom = find_closest_ray_sphere_intersection(o, d, c, bottom_radius);\n\tlet t_top = find_closest_ray_sphere_intersection(o, d, c, top_radius);\n\tif t_bottom < 0.0 {\n\t\tif t_top < 0.0 {\n\t\t\t*t_max = 0.0;\n\t\t\treturn false;\n\t\t} else {\n\t\t\t*t_max = t_top;\n\t\t}\n\t} else {\n\t\tif t_top > 0.0 {\n\t\t\t*t_max = min(t_top, t_bottom);\n\t\t} else {\n\t\t\t*t_max = t_bottom;\n\t\t}\n\t}\n\treturn true;\n}\n\nfn find_atmosphere_t_max_t_bottom(t_max: ptr<function, f32>, t_bottom: ptr<function, f32>, o: vec3<f32>, d: vec3<f32>, c: vec3<f32>, bottom_radius: f32, top_radius: f32) -> bool {\n\t*t_bottom = find_closest_ray_sphere_intersection(o, d, c, bottom_radius);\n\tlet t_top = find_closest_ray_sphere_intersection(o, d, c, top_radius);\n\tif *t_bottom < 0.0 {\n\t\tif t_top < 0.0 {\n\t\t\t*t_max = 0.0;\n\t\t\treturn false;\n\t\t} else {\n\t\t\t*t_max = t_top;\n\t\t}\n\t} else {\n\t\tif t_top > 0.0 {\n\t\t\t*t_max = min(t_top, *t_bottom);\n\t\t} else {\n\t\t\t*t_max = *t_bottom;\n\t\t}\n\t}\n\treturn true;\n}\n\nfn move_to_atmosphere_top(world_pos: ptr<function, vec3<f32>>, world_dir: vec3<f32>, top_radius: f32) -> bool {\n\tlet view_height = length(*world_pos);\n\tif view_height > top_radius {\n\t\tlet t_top = find_closest_ray_sphere_intersection(*world_pos, world_dir, vec3<f32>(), top_radius * 0.9999);\n\t\tif t_top >= 0.0 {\n\t\t\t*world_pos = *world_pos + world_dir * t_top;\n\t\t} else {\n\t\t\treturn false;\n\t\t}\n\t}\n\treturn true;\n}\n";

var mediumWgsl = "/*\n * Copyright (c) 2024 Lukas Herzberger\n * Copyright (c) 2020 Epic Games, Inc.\n * SPDX-License-Identifier: MIT\n */\n\nstruct Atmosphere {\n\t// Rayleigh scattering coefficients\n\trayleigh_scattering: vec3<f32>,\n\t// Rayleigh scattering exponential distribution scale in the atmosphere\n\trayleigh_density_exp_scale: f32,\n\n\t// Mie scattering coefficients\n\tmie_scattering: vec3<f32>,\n\t// Mie scattering exponential distribution scale in the atmosphere\n\tmie_density_exp_scale: f32,\n\t// Mie extinction coefficients\n\tmie_extinction: vec3<f32>,\n\t// Mie phase parameter (Cornette-Shanks excentricity or Henyey-Greenstein-Draine droplet diameter)\n\tmie_phase_param: f32,\n\t// Mie absorption coefficients\n\tmie_absorption: vec3<f32>,\n\t\n\t// Another medium type in the atmosphere\n\tabsorption_density_0_layer_height: f32,\n\tabsorption_density_0_constant_term: f32,\n\tabsorption_density_0_linear_term: f32,\n\tabsorption_density_1_constant_term: f32,\n\tabsorption_density_1_linear_term: f32,\n\t// This other medium only absorb light, e.g. useful to represent ozone in the earth atmosphere\n\tabsorption_extinction: vec3<f32>,\n\n\t// Radius of the planet (center to ground)\n\tbottom_radius: f32,\n\n\t// The albedo of the ground.\n\tground_albedo: vec3<f32>,\n\n\t// Maximum considered atmosphere height (center to atmosphere top)\n\ttop_radius: f32,\n\n\t// planet center in world space (z up)\n\t// used to transform the camera's position to the atmosphere's object space\n\tplanet_center: vec3<f32>,\n\t\n\tmulti_scattering_factor: f32,\n}\n\nstruct MediumSample {\n\tscattering: vec3<f32>,\n\textinction: vec3<f32>,\n\n\tmie_scattering: vec3<f32>,\n\trayleigh_scattering: vec3<f32>,\n}\n\n/*\n * origin is the planet's center\n */\nfn sample_medium_extinction(height: f32, atmosphere: Atmosphere) -> vec3<f32> {\n\tlet mie_density: f32 = exp(atmosphere.mie_density_exp_scale * height);\n\tlet rayleigh_density: f32 = exp(atmosphere.rayleigh_density_exp_scale * height);\n\tvar absorption_density: f32;\n\tif height < atmosphere.absorption_density_0_layer_height {\n\t\tabsorption_density = saturate(atmosphere.absorption_density_0_linear_term * height + atmosphere.absorption_density_0_constant_term);\n\t} else {\n\t\tabsorption_density = saturate(atmosphere.absorption_density_1_linear_term * height + atmosphere.absorption_density_1_constant_term);\n\t}\n\n\tlet mie_extinction = mie_density * atmosphere.mie_extinction;\n\tlet rayleigh_extinction = rayleigh_density * atmosphere.rayleigh_scattering;\n\tlet absorption_extinction = absorption_density * atmosphere.absorption_extinction;\n\n\treturn mie_extinction + rayleigh_extinction + absorption_extinction;\n}\n\nfn sample_medium(height: f32, atmosphere: Atmosphere) -> MediumSample {\n\tlet mie_density: f32 = exp(atmosphere.mie_density_exp_scale * height);\n\tlet rayleigh_density: f32 = exp(atmosphere.rayleigh_density_exp_scale * height);\n\tvar absorption_density: f32;\n\tif height < atmosphere.absorption_density_0_layer_height {\n\t\tabsorption_density = saturate(atmosphere.absorption_density_0_linear_term * height + atmosphere.absorption_density_0_constant_term);\n\t} else {\n\t\tabsorption_density = saturate(atmosphere.absorption_density_1_linear_term * height + atmosphere.absorption_density_1_constant_term);\n\t}\n\n\tvar s: MediumSample;\n\ts.mie_scattering = mie_density * atmosphere.mie_scattering;\n\ts.rayleigh_scattering = rayleigh_density * atmosphere.rayleigh_scattering;\n\ts.scattering = s.mie_scattering + s.rayleigh_scattering;\n\n\tlet mie_extinction = mie_density * atmosphere.mie_extinction;\n\tlet rayleigh_extinction = s.rayleigh_scattering;\n\tlet absorption_extinction = absorption_density * atmosphere.absorption_extinction;\n\ts.extinction = mie_extinction + rayleigh_extinction + absorption_extinction;\n\n\treturn s;\n}\n";

var multipleScatteringWgsl = "/*\n * Copyright (c) 2024 Lukas Herzberger\n * Copyright (c) 2020 Epic Games, Inc.\n * SPDX-License-Identifier: MIT\n */\n\noverride MULTI_SCATTERING_LUT_RES_X: f32 = 32.0;\noverride MULTI_SCATTERING_LUT_RES_Y: f32 = MULTI_SCATTERING_LUT_RES_X;\n\nfn get_multiple_scattering(atmosphere: Atmosphere, scattering: vec3<f32>, extinction: vec3<f32>, worl_pos: vec3<f32>, cos_view_zenith: f32) -> vec3<f32> {\n\tvar uv = saturate(vec2<f32>(cos_view_zenith * 0.5 + 0.5, (length(worl_pos) - atmosphere.bottom_radius) / (atmosphere.top_radius - atmosphere.bottom_radius)));\n\tuv = vec2<f32>(from_unit_to_sub_uvs(uv.x, MULTI_SCATTERING_LUT_RES_X), from_unit_to_sub_uvs(uv.y, MULTI_SCATTERING_LUT_RES_Y));\n\treturn textureSampleLevel(multi_scattering_lut, lut_sampler, uv, 0).rgb;\n}\n";

var phaseWgsl = "/*\n * Copyright (c) 2024 Lukas Herzberger\n * Copyright (c) 2020 Epic Games, Inc.\n * SPDX-License-Identifier: MIT\n */\n\noverride MIE_USE_HG_DRAINE: bool = false;\noverride MIE_USE_HG_DRAINE_DYNAMIC: bool = false;\n\n// https://research.nvidia.com/labs/rtr/approximate-mie/publications/approximate-mie.pdf\n// cloud water droplet diameter in µm (should be 5 µm < d < 50 µm)\noverride HG_DRAINE_DROPLET_DIAMETER: f32 = 3.4;\n// include hg_draine_size\n// include hg_draine_const\n\nconst one_over_four_pi = 1.0 / (2.0 * tau);\n\nconst isotropic_phase: f32 = 1.0 / sphere_solid_angle;\n\nfn draine_phase_dynamic(alpha: f32, g: f32, cos_theta: f32) -> f32 {\n    let g2 = g * g;\n   return one_over_four_pi *\n          ((1.0 - g2) / pow((1.0 + g2 - (2.0 * g * cos_theta)), 1.5)) *\n          ((1.0 + (alpha * cos_theta * cos_theta)) / (1.0 + (alpha * (1.0 / 3.0) * (1.0 + (2.0 * g2)))));\n}\n\nfn hg_draine_phase_dynamic(cos_theta: f32, g_hg: f32, g_d: f32, alpha: f32, w_d: f32) -> f32 {\n    return mix(draine_phase_dynamic(0, g_hg, cos_theta), draine_phase_dynamic(alpha, g_d, cos_theta), w_d);\n}\n\nfn hg_draine_phase_dynamic_dispatch(cos_theta: f32, diameter: f32) -> f32 {\n    if diameter >= 5.0 {\n        return hg_draine_phase_dynamic(\n            cos_theta,\n            exp(-(0.0990567 / (diameter - 1.67154))),\n            exp(-(2.20679 / (diameter + 3.91029)) - 0.428934),\n            exp(3.62489 - (8.29288 / (diameter + 5.52825))),\n            exp(-(0.599085 / (diameter - 0.641583)) - 0.665888),\n        );\n    } else if diameter >= 1.5 {\n        return hg_draine_phase_dynamic(\n            cos_theta,\n            0.0604931 * log(log(diameter)) + 0.940256,\n            0.500411 - 0.081287 / (-2.0 * log(diameter) + tan(log(diameter)) + 1.27551),\n            7.30354 * log(diameter) + 6.31675,\n            0.026914 * (log(diameter) - cos(5.68947 * (log(log(diameter)) - 0.0292149))) + 0.376475,\n        );\n    } else if diameter > 0.1 {\n        return hg_draine_phase_dynamic(\n            cos_theta,\n            0.862 - 0.143 * log(diameter) * log(diameter),\n            0.379685 * cos(1.19692 * cos(((log(diameter) - 0.238604) * (log(diameter) + 1.00667)) / (0.507522 - 0.15677 * log(diameter))) + 1.37932 * log(diameter) + 0.0625835) + 0.344213,\n            250.0,\n            0.146209 * cos(3.38707 * log(diameter) + 2.11193) + 0.316072 + 0.0778917 * log(diameter),\n        );\n    } else {\n        return hg_draine_phase_dynamic(\n            cos_theta,\n            13.8 * diameter * diameter,\n            1.1456 * diameter * sin(9.29044 * diameter),\n            250.0,\n            0.252977 - pow(312.983 * diameter, 4.3),\n        );\n    }\n}\n\nfn cornette_shanks_phase(cos_theta: f32, g: f32) -> f32 {\n\tlet k: f32 = 3.0 / (8.0 * pi) * (1.0 - g * g) / (2.0 + g * g);\n\treturn k * (1.0 + cos_theta * cos_theta) / pow(1.0 + g * g - 2.0 * g * -cos_theta, 1.5);\n}\n\nfn mie_phase(cos_theta: f32, g_or_d: f32) -> f32 {\n    if MIE_USE_HG_DRAINE {\n        if MIE_USE_HG_DRAINE_DYNAMIC {\n            return hg_draine_phase_dynamic_dispatch(cos_theta, g_or_d);\n        } else {\n            return hg_draine_phase(cos_theta);\n        }\n    } else {\n        return cornette_shanks_phase(-cos_theta, g_or_d);\n    }\n}\n\nfn rayleigh_phase(cos_theta: f32) -> f32 {\n\tlet factor: f32 = 3.0f / (16.0f * pi);\n\treturn factor * (1.0f + cos_theta * cos_theta);\n}\n";

var sampleSegmentWgsl = "/*\n * Copyright (c) 2024 Lukas Herzberger\n * SPDX-License-Identifier: MIT\n */\n\noverride RANDOMIZE_SAMPLE_OFFSET: bool = true;\n\nfn pcg_hash(seed: u32) -> u32 {\n\tlet state = seed * 747796405u + 2891336453u;\n\tlet word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;\n\treturn (word >> 22u) ^ word;\n}\n\nfn pcg_hashf(seed: u32) -> f32 {\n\treturn f32(pcg_hash(seed)) / 4294967296.0;\n}\n\nfn pcg_hash3(x: u32, y: u32, z: u32) -> f32 {\n\treturn pcg_hashf((x * 1664525 + y) + z);\n}\n\nfn get_sample_segment_t(uv: vec2<f32>, config: Uniforms) -> f32 {\n\tif RANDOMIZE_SAMPLE_OFFSET {\n\t\tlet seed = vec3<u32>(\n\t\t\tu32(uv.x * config.screen_resolution.x),\n\t\t\tu32(uv.y * config.screen_resolution.y),\n\t\t\tpcg_hash(u32(config.frame_id)),\n\t\t);\n\t\treturn pcg_hash3(seed.x, seed.y, seed.z);\n\t} else {\n\t\treturn 0.3;\n\t}\n}\n";

var shadowBaseWgsl = "/*\n * Copyright (c) 2024 Lukas Herzberger\n * SPDX-License-Identifier: MIT\n */\n\nfn get_sample_shadow(atmosphere: Atmosphere, sample_position: vec3<f32>, light_index: u32) -> f32 {\n\treturn get_shadow((sample_position + atmosphere.planet_center) * FROM_KM_SCALE, light_index);\n}\n";

var skyViewWgsl = "/*\n * Copyright (c) 2024 Lukas Herzberger\n * Copyright (c) 2020 Epic Games, Inc.\n * SPDX-License-Identifier: MIT\n */\n \noverride SKY_VIEW_LUT_RES_X: f32 = 192.0;\noverride SKY_VIEW_LUT_RES_Y: f32 = 108.0;\n\nfn sky_view_lut_params_to_uv(atmosphere: Atmosphere, intersects_ground: bool, cos_view_zenith: f32, cos_light_view: f32, view_height: f32) -> vec2<f32> {\n\tlet v_horizon = sqrt(max(view_height * view_height - atmosphere.bottom_radius * atmosphere.bottom_radius, 0.0));\n\tlet ground_to_horizon = acos(v_horizon / view_height);\n\tlet zenith_horizon_angle = pi - ground_to_horizon;\n\n\tvar uv = vec2<f32>();\n\tif !intersects_ground {\n\t\tlet coord = 1.0 - sqrt(max(1.0 - acos(cos_view_zenith) / zenith_horizon_angle, 0.0));\n\t\tuv.y = coord * 0.5;\n\t} else {\n\t\tlet coord = (acos(cos_view_zenith) - zenith_horizon_angle) / ground_to_horizon;\n\t\tuv.y = sqrt(max(coord, 0.0)) * 0.5 + 0.5;\n\t}\n\tuv.x = sqrt(-cos_light_view * 0.5 + 0.5);\n\n\treturn vec2<f32>(from_unit_to_sub_uvs(uv.x, SKY_VIEW_LUT_RES_X), from_unit_to_sub_uvs(uv.y, SKY_VIEW_LUT_RES_Y));\n}\n";

var sunDiskWgsl = "/*\n * Copyright (c) 2024 Lukas Herzberger\n * SPDX-License-Identifier: MIT\n */\n\noverride RENDER_SUN_DISK: bool = true;\noverride RENDER_MOON_DISK: bool = true;\noverride LIMB_DARKENING_ON_SUN: bool = true;\noverride LIMB_DARKENING_ON_MOON: bool = false;\n\nfn limb_darkeining_factor(center_to_edge: f32) -> vec3<f32> {\n\tlet u = vec3<f32>(1.0);\n\tlet a = vec3<f32>(0.397 , 0.503 , 0.652);\n\tlet inv_center_to_edge = 1.0 - center_to_edge;\n\tlet mu = sqrt(max(1.0 - inv_center_to_edge * inv_center_to_edge, 0.0));\n\treturn 1.0 - u * (1.0 - pow(vec3<f32>(mu), a));\n}\n\nfn sun_disk_luminance(world_pos: vec3<f32>, world_dir: vec3<f32>, atmosphere: Atmosphere, light: AtmosphereLight, apply_limb_darkening: bool) -> vec3<f32> {\n\tlet cos_view_sun = dot(world_dir, light.direction);\n\tlet cos_disk_radius = cos(0.5 * light.disk_diameter);\n\t\n\tif cos_view_sun <= cos_disk_radius || ray_intersects_sphere(world_pos, world_dir, vec3<f32>(), atmosphere.bottom_radius) {\n\t\treturn vec3<f32>();\n\t}\n\n\tlet disk_solid_angle = tau * cos_disk_radius;\n\tlet l_outer_space = (light.illuminance / disk_solid_angle) * light.disk_luminance_scale;\n\n\tlet height = length(world_pos);\n\tlet zenith = world_pos / height;\n\tlet cos_view_zenith = dot(world_dir, zenith);\n\tlet uv = transmittance_lut_params_to_uv(atmosphere, height, cos_view_zenith);\n\tlet transmittance_sun = textureSampleLevel(transmittance_lut, lut_sampler, uv, 0).rgb;\n\n\tif apply_limb_darkening {\n\t\tlet center_to_edge = 1.0 - ((2.0 * acos(cos_view_sun)) / light.disk_diameter);\n\t\treturn transmittance_sun * l_outer_space * limb_darkeining_factor(center_to_edge);\n\t} else {\n\t\treturn transmittance_sun * l_outer_space;\n\t}\n}\n\nfn get_sun_luminance(world_pos: vec3<f32>, world_dir: vec3<f32>, atmosphere: Atmosphere, uniforms: Uniforms) -> vec3<f32> {\n\tvar sun_luminance = vec3<f32>();\n\tif RENDER_SUN_DISK {\n\t\tsun_luminance += sun_disk_luminance(world_pos, world_dir, atmosphere, uniforms.sun, LIMB_DARKENING_ON_SUN);\n\t}\n\tif RENDER_MOON_DISK && USE_MOON {\n\t\tsun_luminance += sun_disk_luminance(world_pos, world_dir, atmosphere, uniforms.moon, LIMB_DARKENING_ON_MOON);\n\t}\n\treturn sun_luminance;\n}\n";

var uniformsWgsl = "/*\n * Copyright (c) 2024 Lukas Herzberger\n * Copyright (c) 2020 Epic Games, Inc.\n * SPDX-License-Identifier: MIT\n */\n\nstruct AtmosphereLight {\n\t// Sun light's illuminance\n\tilluminance: vec3<f32>,\n\t\n\t// Sun disk's angular diameter in radians\n\tdisk_diameter: f32,\n\t\n\t// Sun light's direction (direction pointing to the sun)\n\tdirection: vec3<f32>,\n\n\t// Sun disk's luminance\n\tdisk_luminance_scale: f32,\n}\n\nstruct Uniforms {\n\t// Inverse projection matrix for the current camera view\n\tinverse_projection: mat4x4<f32>,\n\n\t// Inverse view matrix for the current camera view\n\tinverse_view: mat4x4<f32>,\n\n\t// World position of the current camera view\n\tcamera_world_position: vec3<f32>,\n\n\t// Resolution of the multiscattering LUT (width = height)\n\tframe_id: f32,\n\n\t// Resolution of the output texture\n\tscreen_resolution: vec2<f32>,\n\n\t// Minimum number of ray marching samples per pixel\n\tray_march_min_spp: f32,\n\n\t// Maximum number of ray marching samples per pixel\n\tray_march_max_spp: f32,\n\n\t// Sun parameters\n\tsun: AtmosphereLight,\n\n\t// Moon / second sun parameters \n\tmoon: AtmosphereLight,\n}\n\n";

var uvWgsl = "/*\n * Copyright (c) 2024 Lukas Herzberger\n * Copyright (c) 2020 Epic Games, Inc.\n * SPDX-License-Identifier: MIT\n */\n\nfn from_sub_uvs_to_unit(u: f32, resolution: f32) -> f32 {\n\treturn (u - 0.5 / resolution) * (resolution / (resolution - 1.0));\n}\n\nfn from_unit_to_sub_uvs(u: f32, resolution: f32) -> f32 {\n\treturn (u + 0.5 / resolution) * (resolution / (resolution + 1.0));\n}\n\nfn transmittance_lut_params_to_uv(atmosphere: Atmosphere, view_height: f32, cos_view_zenith: f32) -> vec2<f32> {\n\tlet height_sq = view_height * view_height;\n\tlet bottom_radius_sq = atmosphere.bottom_radius * atmosphere.bottom_radius;\n\tlet top_radius_sq = atmosphere.top_radius * atmosphere.top_radius;\n\tlet h = sqrt(max(0.0, top_radius_sq - bottom_radius_sq));\n\tlet rho = sqrt(max(0.0, height_sq - bottom_radius_sq));\n\n\tlet discriminant = height_sq * (cos_view_zenith * cos_view_zenith - 1.0) + top_radius_sq;\n\tlet distance_to_boundary = max(0.0, (-view_height * cos_view_zenith + sqrt(max(discriminant, 0.0))));\n\n\tlet min_distance = atmosphere.top_radius - view_height;\n\tlet max_distance = rho + h;\n\tlet x_mu = (distance_to_boundary - min_distance) / (max_distance - min_distance);\n\tlet x_r = rho / h;\n\n\treturn vec2<f32>(x_mu, x_r);\n}\n";

var renderTransmittanceLutWgsl = "/*\n * Copyright (c) 2024 Lukas Herzberger\n * Copyright (c) 2020 Epic Games, Inc.\n * SPDX-License-Identifier: MIT\n */\n\noverride SAMPLE_COUNT: u32 = 40;\n\noverride WORKGROUP_SIZE_X: u32 = 16;\noverride WORKGROUP_SIZE_Y: u32 = 16;\n\n@group(0) @binding(0) var<uniform> atmosphere_buffer: Atmosphere;\n@group(0) @binding(1) var transmittance_lut : texture_storage_2d<rgba16float, write>;\n\nfn find_closest_ray_circle_intersection(o: vec2<f32>, d: vec2<f32>, r: f32) -> f32 {\n\treturn solve_quadratic_for_positive_reals(dot(d, d), 2.0 * dot(d, o), dot(o, o) - (r * r));\n}\n\nfn find_atmosphere_t_max_2d(t_max: ptr<function, f32>, o: vec2<f32>, d: vec2<f32>, bottom_radius: f32, top_radius: f32) -> bool {\n\tlet t_bottom = find_closest_ray_circle_intersection(o, d, bottom_radius);\n\tlet t_top = find_closest_ray_circle_intersection(o, d, top_radius);\n\tif t_bottom < 0.0 {\n\t\tif t_top < 0.0 {\n\t\t\t*t_max = 0.0;\n\t\t\treturn false;\n\t\t} else {\n\t\t\t*t_max = t_top;\n\t\t}\n\t} else {\n\t\tif t_top > 0.0 {\n\t\t\t*t_max = min(t_top, t_bottom);\n\t\t} else {\n\t\t\t*t_max = 0.0;\n\t\t}\n\t}\n\treturn true;\n}\n\nfn uv_to_transmittance_lut_params(uv: vec2<f32>, atmosphere: Atmosphere) -> vec2<f32> {\n\tlet x_mu: f32 = uv.x;\n\tlet x_r: f32 = uv.y;\n\n\tlet bottom_radius_sq = atmosphere.bottom_radius * atmosphere.bottom_radius;\n\tlet h_sq = atmosphere.top_radius * atmosphere.top_radius - bottom_radius_sq;\n\tlet h: f32 = sqrt(h_sq);\n\tlet rho: f32 = h * x_r;\n\tlet rho_sq = rho * rho;\n\tlet view_height = sqrt(rho_sq + bottom_radius_sq);\n\n\tlet d_min: f32 = atmosphere.top_radius - view_height;\n\tlet d_max: f32 = rho + h;\n\tlet d: f32 = d_min + x_mu * (d_max - d_min);\n\n\tvar cos_view_zenith = 1.0;\n\tif d != 0.0 {\n\t\tcos_view_zenith = clamp((h_sq - rho_sq - d * d) / (2.0 * view_height * d), -1.0, 1.0);\n\t}\n\n\treturn vec2<f32>(view_height, cos_view_zenith);\n}\n\n@compute\n@workgroup_size(WORKGROUP_SIZE_X, WORKGROUP_SIZE_Y, 1)\nfn render_transmittance_lut(@builtin(global_invocation_id) global_id: vec3<u32>) {\n\tlet output_size = vec2<u32>(textureDimensions(transmittance_lut));\n\tif output_size.x <= global_id.x || output_size.y <= global_id.y {\n\t\treturn;\n\t}\n\n\tlet pix = vec2<f32>(global_id.xy) + 0.5;\n\tlet uv = pix / vec2<f32>(output_size);\n\n\tlet atmosphere = atmosphere_buffer;\n\n\t// Compute camera position from LUT coords\n\tlet lut_params = uv_to_transmittance_lut_params(uv, atmosphere);\n\tlet view_height = lut_params.x;\n\tlet cos_view_zenith = lut_params.y;\n\tlet world_pos = vec2<f32>(0.0, view_height);\n\tlet world_dir = vec2<f32>(sqrt(1.0 - cos_view_zenith * cos_view_zenith), cos_view_zenith);\n\n\tvar transmittance = vec3<f32>();\n\n\t// Compute next intersection with atmosphere or ground\n\tvar t_max: f32 = 0.0;\n\tif find_atmosphere_t_max_2d(&t_max, world_pos, world_dir, atmosphere.bottom_radius, atmosphere.top_radius) {\n\t\tt_max = min(t_max, t_max_max);\n\n\t\t// Sample count\n\t\tlet sample_count = f32(SAMPLE_COUNT);\t// Can go a low as 10 sample but energy lost starts to be visible.\n\t\tlet sample_segment_t: f32 = 0.3f;\n\t\tlet dt = t_max / sample_count;\n\n\t\t// Ray march the atmosphere to integrate optical depth\n\t\tvar t = 0.0f;\n\t\tvar dt_exact = 0.0f;\n\t\tfor (var s: f32 = 0.0f; s < sample_count; s += 1.0f) {\n\t\t\tlet t_new = (s + sample_segment_t) * dt;\n\t\t\tdt_exact = t_new - t;\n\t\t\tt = t_new;\n\n\t\t\tlet sample_height = length(world_pos + t * world_dir) - atmosphere.bottom_radius;\n\t\t\ttransmittance += sample_medium_extinction(sample_height, atmosphere) * dt_exact;\n\t\t}\n\n\t\ttransmittance = exp(-transmittance);\n\t}\n\n\ttextureStore(transmittance_lut, global_id.xy, vec4<f32>(transmittance, 1.0));\n}\n";

var renderMultiScatteringLutWgsl = "/*\n * Copyright (c) 2024 Lukas Herzberger\n * Copyright (c) 2020 Epic Games, Inc.\n * SPDX-License-Identifier: MIT\n */\n \noverride SAMPLE_COUNT: u32 = 20;\n\n@group(0) @binding(0) var<uniform> atmosphere_buffer: Atmosphere;\n@group(0) @binding(1) var lut_sampler: sampler;\n@group(0) @binding(2) var transmittance_lut: texture_2d<f32>;\n@group(0) @binding(3) var multi_scattering_lut: texture_storage_2d<rgba16float, write>;\n\nconst direction_sample_count: f32 = 64.0;\nconst workgroup_size_z: u32 = 64;\n\nvar<workgroup> shared_multi_scattering: array<vec3<f32>, workgroup_size_z>;\nvar<workgroup> shared_luminance: array<vec3<f32>, workgroup_size_z>;\n\nfn get_transmittance_to_sun(sun_dir: vec3<f32>, zenith: vec3<f32>, atmosphere: Atmosphere, sample_height: f32) -> vec3<f32> {\n\tlet cos_sun_zenith = dot(sun_dir, zenith);\n\tlet uv = transmittance_lut_params_to_uv(atmosphere, sample_height, cos_sun_zenith);\n\treturn textureSampleLevel(transmittance_lut, lut_sampler, uv, 0).rgb;\n}\n\nstruct IntegrationResults {\n\tluminance: vec3<f32>,\n\tmulti_scattering: vec3<f32>,\n}\n\nfn integrate_scattered_luminance(world_pos: vec3<f32>, world_dir: vec3<f32>, sun_dir: vec3<f32>, atmosphere: Atmosphere) -> IntegrationResults {\n\tvar result = IntegrationResults();\n\n\tlet planet_center = vec3<f32>();\n\tvar t_max: f32 = 0.0;\n\tvar t_bottom: f32 = 0.0;\n\tif !find_atmosphere_t_max_t_bottom(&t_max, &t_bottom, world_pos, world_dir, planet_center, atmosphere.bottom_radius, atmosphere.top_radius) {\n\t\treturn result;\n\t}\n\tt_max = min(t_max, t_max_max);\n\n\tlet sample_count = f32(SAMPLE_COUNT);\n\tlet sample_segment_t = 0.3;\n\tlet dt = t_max / sample_count;\n\n\tvar throughput = vec3<f32>(1.0);\n\tvar t = 0.0;\n\tvar dt_exact = 0.0;\n\tfor (var s = 0.0; s < sample_count; s += 1.0) {\n\t\tlet t_new = (s + sample_segment_t) * dt;\n\t\tdt_exact = t_new - t;\n\t\tt = t_new;\n\n\t\tlet sample_pos = world_pos + t * world_dir;\n\t\tlet sample_height = length(sample_pos);\n\n\t\tlet zenith = sample_pos / sample_height;\n\t\tlet transmittance_to_sun = get_transmittance_to_sun(sun_dir, zenith, atmosphere, sample_height);\n\n\t\tlet medium = sample_medium(sample_height - atmosphere.bottom_radius, atmosphere);\n\t\tlet sample_transmittance = exp(-medium.extinction * dt_exact);\n\n\t\tlet planet_shadow = compute_planet_shadow(sample_pos, sun_dir, planet_center + planet_radius_offset * zenith, atmosphere.bottom_radius);\n\t\tlet scattered_luminance = planet_shadow * transmittance_to_sun * (medium.scattering * isotropic_phase);\n\n\t\tresult.multi_scattering += throughput * (medium.scattering - medium.scattering * sample_transmittance) / medium.extinction;\n\t\tresult.luminance += throughput * (scattered_luminance - scattered_luminance * sample_transmittance) / medium.extinction;\n\n\t\tthroughput *= sample_transmittance;\n\t}\n\n\t// Account for light bounced off the planet\n\tif t_max == t_bottom && t_bottom > 0.0 {\n\t\tlet t = t_bottom;\n\t\tlet sample_pos = world_pos + t * world_dir;\n\t\tlet sample_height = length(sample_pos);\n\n\t\tlet zenith = sample_pos / sample_height;\n\t\tlet transmittance_to_sun = get_transmittance_to_sun(sun_dir, zenith, atmosphere, sample_height);\n\n\t\tlet n_dot_l = saturate(dot(zenith, sun_dir));\n\t\tresult.luminance += transmittance_to_sun * throughput * n_dot_l * atmosphere.ground_albedo / pi;\n\t}\n\n\treturn result;\n}\n\nfn compute_sample_direction(direction_index: u32) -> vec3<f32> {\n\tlet sample = f32(direction_index);\n\tlet theta = tau * sample / golden_ratio;\n\tlet phi = acos(1.0 - 2.0 * (sample + 0.5) / direction_sample_count);\n\tlet cos_phi = cos(phi);\n\tlet sin_phi = sin(phi);\n\tlet cos_theta = cos(theta);\n\tlet sin_theta = sin(theta);\n\treturn vec3<f32>(\n\t\tcos_theta * sin_phi,\n\t\tsin_theta * sin_phi,\n\t\tcos_phi\n\t);\n}\n\n@compute\n@workgroup_size(1, 1, workgroup_size_z)\nfn render_multi_scattering_lut(@builtin(global_invocation_id) global_id: vec3<u32>) {\n\tlet output_size = textureDimensions(multi_scattering_lut);\n\tlet direction_index = global_id.z;\n\n\tlet pix = vec2<f32>(global_id.xy) + 0.5;\n\tvar uv = pix / vec2<f32>(output_size);\n\tuv = vec2<f32>(from_sub_uvs_to_unit(uv.x, f32(output_size.x)), from_sub_uvs_to_unit(uv.y, f32(output_size.y)));\n\n\tlet atmosphere = atmosphere_buffer;\n\n\tlet cos_sun_zenith = uv.x * 2.0 - 1.0;\n\tlet sun_dir = vec3<f32>(0.0, sqrt(saturate(1.0 - cos_sun_zenith * cos_sun_zenith)), cos_sun_zenith);\n\tlet view_height = atmosphere.bottom_radius + saturate(uv.y + planet_radius_offset) * (atmosphere.top_radius - atmosphere.bottom_radius - planet_radius_offset);\n\n\tlet world_pos = vec3<f32>(0.0, 0.0, view_height);\n\tlet world_dir = compute_sample_direction(direction_index);\n\n\tlet scattering_result = integrate_scattered_luminance(world_pos, world_dir, normalize(sun_dir), atmosphere);\n\n\tshared_multi_scattering[direction_index] = scattering_result.multi_scattering / direction_sample_count;\n\tshared_luminance[direction_index] = scattering_result.luminance / direction_sample_count;\n\n\tworkgroupBarrier();\n\n\t// reduce samples - the last remaining thread publishes the result\n\tfor (var i = 32u; i > 0; i = i >> 1) {\n\t\tif direction_index < i {\n\t\t\tshared_multi_scattering[direction_index] += shared_multi_scattering[direction_index + i];\n\t\t\tshared_luminance[direction_index] += shared_luminance[direction_index + i];\n\t\t}\n\t\tworkgroupBarrier();\n\t}\n\tif direction_index > 0 {\n\t\treturn;\n\t}\n\n\tlet luminance = shared_luminance[0] * (1.0 / (1.0 - shared_multi_scattering[0]));\n\n\ttextureStore(multi_scattering_lut, global_id.xy, vec4<f32>(atmosphere.multi_scattering_factor * luminance, 1.0));\n}\n\n";

var renderSkyViewLutWgsl = "/*\n * Copyright (c) 2024 Lukas Herzberger\n * Copyright (c) 2020 Epic Games, Inc.\n * SPDX-License-Identifier: MIT\n */\n\noverride SKY_VIEW_LUT_RES_X: f32 = 192.0;\noverride SKY_VIEW_LUT_RES_Y: f32 = 108.0;\n\noverride INV_DISTANCE_TO_MAX_SAMPLE_COUNT: f32 = 1.0 / 100.0;\n\noverride USE_MOON: bool = false;\n\noverride WORKGROUP_SIZE_X: u32 = 16;\noverride WORKGROUP_SIZE_Y: u32 = 16;\n\n@group(0) @binding(0) var<uniform> atmosphere_buffer: Atmosphere;\n@group(0) @binding(1) var<uniform> config_buffer: Uniforms;\n@group(0) @binding(2) var lut_sampler: sampler;\n@group(0) @binding(3) var transmittance_lut: texture_2d<f32>;\n@group(0) @binding(4) var multi_scattering_lut: texture_2d<f32>;\n@group(0) @binding(5) var sky_view_lut : texture_storage_2d<rgba16float, write>;\n\nstruct SingleScatteringResult {\n\tluminance: vec3<f32>,\t\t\t\t// Scattered light (luminance)\n\ttransmittance: vec3<f32>,\t\t\t// transmittance in [0,1] (unitless)\n}\n\nfn integrate_scattered_luminance(world_pos: vec3<f32>, world_dir: vec3<f32>, sun_dir: vec3<f32>, moon_dir: vec3<f32>, atmosphere: Atmosphere, config: Uniforms) -> SingleScatteringResult {\n\tvar result = SingleScatteringResult();\n\t\n\tlet planet_center = vec3<f32>();\n\tvar t_max: f32 = 0.0;\n\tif !find_atmosphere_t_max(&t_max, world_pos, world_dir, planet_center, atmosphere.bottom_radius, atmosphere.top_radius) {\n\t\treturn result;\n\t}\n\tt_max = min(t_max, t_max_max);\n\n\tlet sample_count = mix(config.ray_march_min_spp, config.ray_march_max_spp, saturate(t_max * INV_DISTANCE_TO_MAX_SAMPLE_COUNT));\n\tlet sample_count_floored = floor(sample_count);\n\tlet inv_sample_count_floored = 1.0 / sample_count_floored;\n\tlet t_max_floored = t_max * sample_count_floored / sample_count;\n\tlet sample_segment_t = 0.3;\n\n\tlet sun_direction = normalize(sun_dir);\n\tlet sun_illuminance = config.sun.illuminance;\n\n\tlet cos_theta = dot(sun_dir, world_dir);\n\tlet mie_phase_val = mie_phase(cos_theta, atmosphere.mie_phase_param);\n\tlet rayleigh_phase_val = rayleigh_phase(cos_theta);\n\t\n\tvar moon_direction = moon_dir;\n\tvar moon_illuminance = config.moon.illuminance;\n\n\tvar cos_theta_moon = 0.0;\n\tvar mie_phase_val_moon = 0.0;\n\tvar rayleigh_phase_val_moon = 0.0;\n\n\tif USE_MOON {\n\t\tmoon_direction = normalize(moon_direction);\n\t\tmoon_illuminance = config.moon.illuminance;\n\n\t\tcos_theta_moon = dot(moon_direction, world_dir);\n\t\tmie_phase_val_moon = mie_phase(cos_theta_moon, atmosphere.mie_phase_param);\n\t\trayleigh_phase_val_moon = rayleigh_phase(cos_theta_moon);\n\t}\n\n\tresult.luminance = vec3<f32>(0.0);\n\tresult.transmittance = vec3<f32>(1.0);\n\tvar t = 0.0;\n\tvar dt = t_max / sample_count;\n\tfor (var s = 0.0; s < sample_count; s += 1.0) {\n\t\tvar t0 = s * inv_sample_count_floored;\n\t\tvar t1 = (s + 1.0) * inv_sample_count_floored;\n\t\tt0 = (t0 * t0) * t_max_floored;\n\t\tt1 = t1 * t1;\n\t\tif t1 > 1.0 {\n\t\t\tt1 = t_max;\n\t\t} else {\n\t\t\tt1 = t_max_floored * t1;\n\t\t}\n\t\tdt = t1 - t0;\n\t\tt = t0 + dt * sample_segment_t;\n\n\t\tlet sample_pos = world_pos + t * world_dir;\n\t\tlet sample_height = length(sample_pos);\n\n\t\tlet medium = sample_medium(sample_height - atmosphere.bottom_radius, atmosphere);\n\t\tlet sample_transmittance = exp(-medium.extinction * dt);\n\n\t\tlet zenith = sample_pos / sample_height;\n \n\t\tlet cos_sun_zenith = dot(sun_direction, zenith);\n\t\tlet transmittance_to_sun = textureSampleLevel(transmittance_lut, lut_sampler, transmittance_lut_params_to_uv(atmosphere, sample_height, cos_sun_zenith), 0).rgb;\n\t\tlet phase_times_scattering = medium.mie_scattering * mie_phase_val + medium.rayleigh_scattering * rayleigh_phase_val;\n\t\tlet multi_scattered_luminance = get_multiple_scattering(atmosphere, medium.scattering, medium.extinction, sample_pos, cos_sun_zenith);\n\t\tlet planet_shadow = compute_planet_shadow(sample_pos, sun_direction, planet_center + planet_radius_offset * zenith, atmosphere.bottom_radius);\n\t\tlet shadow = get_sample_shadow(atmosphere, sample_pos, 0);\n\n\t\tvar scattered_luminance = sun_illuminance * (planet_shadow * shadow * transmittance_to_sun * phase_times_scattering + multi_scattered_luminance * medium.scattering);\n\n\t\tif USE_MOON {\n\t\t\tlet cos_moon_zenith = dot(moon_direction, zenith);\n\t\t\tlet transmittance_to_moon = textureSampleLevel(transmittance_lut, lut_sampler, transmittance_lut_params_to_uv(atmosphere, sample_height, cos_moon_zenith), 0).rgb;\n\t\t\tlet phase_times_scattering_moon = medium.mie_scattering * mie_phase_val_moon + medium.rayleigh_scattering * rayleigh_phase_val_moon;\n\t\t\tlet multi_scattered_luminance_moon = get_multiple_scattering(atmosphere, medium.scattering, medium.extinction, sample_pos, cos_moon_zenith);\n\t\t\tlet planet_shadow_moon = compute_planet_shadow(sample_pos, moon_direction, planet_center + planet_radius_offset * zenith, atmosphere.bottom_radius);\n\t\t\tlet shadow_moon = get_sample_shadow(atmosphere, sample_pos, 1);\n\n\t\t\tscattered_luminance += moon_illuminance * (planet_shadow_moon * shadow_moon * transmittance_to_moon * phase_times_scattering_moon + multi_scattered_luminance_moon * medium.scattering);\n\t\t}\n\n\t\tlet intergrated_luminance = (scattered_luminance - scattered_luminance * sample_transmittance) / medium.extinction;\n\t\tresult.luminance += result.transmittance * intergrated_luminance;\n\t\tresult.transmittance *= sample_transmittance;\n\t}\n\t\n\treturn result;\n}\n\nfn compute_sun_dir(sun_dir: vec3<f32>, zenith: vec3<f32>) -> vec3<f32> {\n\tlet cos_sun_zenith = dot(zenith, sun_dir);\n\treturn normalize(vec3<f32>(sqrt(max(1.0 - cos_sun_zenith * cos_sun_zenith, 0.0)), 0.0, cos_sun_zenith));\n}\n\nfn compute_world_dir(uv_in: vec2<f32>, sky_view_res: vec2<f32>, view_height: f32, atmosphere: Atmosphere) -> vec3<f32> {\n\tlet uv = vec2<f32>(from_sub_uvs_to_unit(uv_in.x, sky_view_res.x), from_sub_uvs_to_unit(uv_in.y, sky_view_res.y));\n\n\tlet v_horizon = sqrt(max(view_height * view_height - atmosphere.bottom_radius * atmosphere.bottom_radius, 0.0));\n\tlet ground_to_horizon_angle = acos(v_horizon / view_height);\n\tlet zenith_horizon_angle = pi - ground_to_horizon_angle;\n\n\tvar cos_view_zenith: f32;\n\tif uv.y < 0.5 {\n\t\tlet coord = 1.0 - (2.0 * uv.y);\n\t\tcos_view_zenith = cos(zenith_horizon_angle * (1.0 - (coord * coord)));\n\t} else {\n\t\tlet coord = (uv.y * 2.0) - 1.0;\n\t\tcos_view_zenith = cos(zenith_horizon_angle + ground_to_horizon_angle * (coord * coord));\n\t}\n\tlet cos_light_view = -((uv.x * uv.x) * 2.0 - 1.0);\n\tlet sin_view_zenith = sqrt(max(1.0 - cos_view_zenith * cos_view_zenith, 0.0));\n\n\treturn vec3<f32>(\n\t\tsin_view_zenith * cos_light_view,\n\t\tsin_view_zenith * sqrt(max(1.0 - cos_light_view * cos_light_view, 0.0)),\n\t\tcos_view_zenith\n\t);\n}\n\n@compute\n@workgroup_size(WORKGROUP_SIZE_X, WORKGROUP_SIZE_Y, 1)\nfn render_sky_view_lut(@builtin(global_invocation_id) global_id: vec3<u32>) {\n\tlet output_size = vec2<u32>(textureDimensions(sky_view_lut));\n\tif output_size.x <= global_id.x || output_size.y <= global_id.y {\n\t\treturn;\n\t}\n\n\tlet sky_view_lut_res = vec2<f32>(SKY_VIEW_LUT_RES_X, SKY_VIEW_LUT_RES_Y); // vec2<f32>(output_size); <- tex dimensions produce artefacts!\n\n\tlet pix = vec2<f32>(global_id.xy) + 0.5;\n\tlet uv = pix / sky_view_lut_res;\n\n\tlet atmosphere = atmosphere_buffer;\n\tlet config = config_buffer;\n\n\tlet view_world_pos = (config.camera_world_position * TO_KM_SCALE) - atmosphere.planet_center;\n\tlet world_sun_dir = normalize(config.sun.direction);\n\tlet world_moon_dir = normalize(config.moon.direction);\n\n\tlet view_height = length(view_world_pos);\n\n\tlet zenith = view_world_pos / view_height;\n\tlet sun_dir = compute_sun_dir(world_sun_dir, zenith);\n\tlet moon_dir = compute_sun_dir(world_moon_dir, zenith);\n\n\tvar world_pos = vec3<f32>(0.0, 0.0, view_height);\n\tlet world_dir = compute_world_dir(uv, sky_view_lut_res, view_height, atmosphere);\n\n\tif !move_to_atmosphere_top(&world_pos, world_dir, atmosphere.top_radius) {\n\t\ttextureStore(sky_view_lut, global_id.xy, vec4<f32>(0, 0, 0, 1));\n\t\treturn;\n\t}\n\n\tlet ss = integrate_scattered_luminance(world_pos, world_dir, sun_dir, moon_dir, atmosphere, config);\n\n\ttextureStore(sky_view_lut, global_id.xy, vec4<f32>(ss.luminance, 1.0 - dot(ss.transmittance, vec3<f32>(1.0 / 3.0))));\n}\n";

var renderAerialPerspectiveWgsl = "/*\n * Copyright (c) 2024 Lukas Herzberger\n * Copyright (c) 2020 Epic Games, Inc.\n * SPDX-License-Identifier: MIT\n */\n\noverride USE_MOON: bool = false;\n\noverride WORKGROUP_SIZE_X: u32 = 16;\noverride WORKGROUP_SIZE_Y: u32 = 16;\n\n@group(0) @binding(0) var<uniform> atmosphere_buffer: Atmosphere;\n@group(0) @binding(1) var<uniform> config_buffer: Uniforms;\n@group(0) @binding(2) var lut_sampler: sampler;\n@group(0) @binding(3) var transmittance_lut: texture_2d<f32>;\n@group(0) @binding(4) var multi_scattering_lut: texture_2d<f32>;\n@group(0) @binding(5) var aerial_perspective_lut: texture_storage_3d<rgba16float, write>;\n\nstruct SingleScatteringResult {\n\tluminance: vec3<f32>,\t\t\t\t// Scattered light (luminance)\n\ttransmittance: vec3<f32>,\t\t\t// Transmittance in [0,1] (unitless)\n}\n\nfn integrate_scattered_luminance(uv: vec2<f32>, world_pos: vec3<f32>, world_dir: vec3<f32>, atmosphere: Atmosphere, config: Uniforms, sample_count: f32, t_max_bound: f32) -> SingleScatteringResult {\n\tvar result = SingleScatteringResult();\n\n\tlet planet_center = vec3<f32>();\n\tvar t_max: f32 = 0.0;\n\tif !find_atmosphere_t_max(&t_max, world_pos, world_dir, planet_center, atmosphere.bottom_radius, atmosphere.top_radius) {\n\t\treturn result;\n\t}\n\tt_max = min(t_max, t_max_bound);\n\n\tlet sample_segment_t = get_sample_segment_t(uv, config);\n\tlet dt = t_max / sample_count;\n\n\tlet sun_direction = normalize(config.sun.direction);\n\tlet sun_illuminance = config.sun.illuminance;\n\n\tlet cos_theta = dot(sun_direction, world_dir);\n\tlet mie_phase_val = mie_phase(cos_theta, atmosphere.mie_phase_param);\n\tlet rayleigh_phase_val = rayleigh_phase(cos_theta);\n\n\tvar moon_direction = config.moon.direction;\n\tvar moon_illuminance = config.moon.illuminance;\n\n\tvar cos_theta_moon = 0.0;\n\tvar mie_phase_val_moon = 0.0;\n\tvar rayleigh_phase_val_moon = 0.0;\n\n\tif USE_MOON {\n\t\tmoon_direction = normalize(moon_direction);\n\t\tmoon_illuminance = config.moon.illuminance;\n\n\t\tcos_theta_moon = dot(moon_direction, world_dir);\n\t\tmie_phase_val_moon = mie_phase(cos_theta_moon, atmosphere.mie_phase_param);\n\t\trayleigh_phase_val_moon = rayleigh_phase(cos_theta_moon);\n\t}\n\n\tresult.luminance = vec3<f32>(0.0);\n\tresult.transmittance = vec3<f32>(1.0);\n\tvar t = 0.0;\n\tvar dt_exact = 0.0;\n\tfor (var s = 0.0; s < sample_count; s += 1.0) {\n\t\tlet t_new = (s + sample_segment_t) * dt;\n\t\tdt_exact = t_new - t;\n\t\tt = t_new;\n\n\t\tlet sample_pos = world_pos + t * world_dir;\n\t\tlet sample_height = length(sample_pos);\n\n\t\tlet medium = sample_medium(sample_height - atmosphere.bottom_radius, atmosphere);\n\t\tlet sample_transmittance = exp(-medium.extinction * dt_exact);\n\n\t\tlet zenith = sample_pos / sample_height;\n\n\t\tlet cos_sun_zenith = dot(sun_direction, zenith);\n\t\tlet transmittance_to_sun = textureSampleLevel(transmittance_lut, lut_sampler, transmittance_lut_params_to_uv(atmosphere, sample_height, cos_sun_zenith), 0).rgb;\n\t\tlet phase_times_scattering = medium.mie_scattering * mie_phase_val + medium.rayleigh_scattering * rayleigh_phase_val;\n\t\tlet multi_scattered_luminance = get_multiple_scattering(atmosphere, medium.scattering, medium.extinction, sample_pos, cos_sun_zenith);\n\t\tlet planet_shadow = compute_planet_shadow(sample_pos, sun_direction, planet_center + planet_radius_offset * zenith, atmosphere.bottom_radius);\n\t\tlet shadow = get_sample_shadow(atmosphere, sample_pos, 0);\n\n\t\tvar scattered_luminance = sun_illuminance * (planet_shadow * shadow * transmittance_to_sun * phase_times_scattering + multi_scattered_luminance * medium.scattering);\n\n\t\tif USE_MOON {\n\t\t\tlet cos_moon_zenith = dot(moon_direction, zenith);\n\t\t\tlet transmittance_to_moon = textureSampleLevel(transmittance_lut, lut_sampler, transmittance_lut_params_to_uv(atmosphere, sample_height, cos_moon_zenith), 0).rgb;\n\t\t\tlet phase_times_scattering_moon = medium.mie_scattering * mie_phase_val_moon + medium.rayleigh_scattering * rayleigh_phase_val_moon;\n\t\t\tlet multi_scattered_luminance_moon = get_multiple_scattering(atmosphere, medium.scattering, medium.extinction, sample_pos, cos_moon_zenith);\n\t\t\tlet planet_shadow_moon = compute_planet_shadow(sample_pos, moon_direction, planet_center + planet_radius_offset * zenith, atmosphere.bottom_radius);\n\t\t\tlet shadow_moon = get_sample_shadow(atmosphere, sample_pos, 1);\n\n\t\t\tscattered_luminance += moon_illuminance * (planet_shadow_moon * shadow_moon * transmittance_to_moon * phase_times_scattering_moon + multi_scattered_luminance_moon * medium.scattering);\n\t\t}\n\n\t\tlet intergrated_luminance = (scattered_luminance - scattered_luminance * sample_transmittance) / medium.extinction;\n\t\tresult.luminance += result.transmittance * intergrated_luminance;\n\t\tresult.transmittance *= sample_transmittance;\n\t}\n\n\treturn result;\n}\n\nfn thread_z_to_slice(thread_z: u32) -> f32 {\n\tlet slice = ((f32(thread_z) + 0.5) / AP_SLICE_COUNT);\n\treturn (slice * slice) * AP_SLICE_COUNT; // squared distribution\n}\n\n@compute\n@workgroup_size(WORKGROUP_SIZE_X, WORKGROUP_SIZE_Y, 1)\nfn render_aerial_perspective_lut(@builtin(global_invocation_id) global_id: vec3<u32>) {\n\tlet output_size = vec2<u32>(textureDimensions(aerial_perspective_lut).xy);\n\tif output_size.x <= global_id.x || output_size.y <= global_id.y {\n\t\treturn;\n\t}\n\n\tlet atmosphere = atmosphere_buffer;\n\tlet config = config_buffer;\n\n\tlet pix = vec2<f32>(global_id.xy) + 0.5;\n\tlet uv = pix / vec2<f32>(output_size.xy);\n\n\tvar world_dir = uv_to_world_dir(uv, config.inverse_projection, config.inverse_view);\n\tlet cam_pos = (config.camera_world_position * TO_KM_SCALE) - atmosphere.planet_center;\n\n\tvar world_pos = cam_pos;\n\n\tvar t_max = aerial_perspective_slice_to_depth(thread_z_to_slice(global_id.z));\n\tvar slice_start_pos = world_pos + t_max * world_dir;\n\n\tvar view_height = length(slice_start_pos);\n\tif view_height <= (atmosphere.bottom_radius + planet_radius_offset) {\n\t\tslice_start_pos = normalize(slice_start_pos) * (atmosphere.bottom_radius + planet_radius_offset + 0.001);\n\t\tworld_dir = normalize(slice_start_pos - cam_pos);\n\t\tt_max = length(slice_start_pos - cam_pos);\n\t}\n\n\tview_height = length(world_pos);\n\tif view_height >= atmosphere.top_radius {\n\t\tlet prev_world_pos = world_pos;\n\t\tif !move_to_atmosphere_top(&world_pos, world_dir, atmosphere.top_radius) {\n\t\t\ttextureStore(aerial_perspective_lut, global_id, vec4<f32>(0.0, 0.0, 0.0, 1.0));\n\t\t\treturn;\n\t\t}\n\t\tlet distance_to_atmosphere = length(prev_world_pos - world_pos);\n\t\tif t_max < distance_to_atmosphere {\n\t\t\ttextureStore(aerial_perspective_lut, global_id, vec4<f32>(0.0, 0.0, 0.0, 1.0));\n\t\t\treturn;\n\t\t}\n\t\tt_max = max(0.0, t_max - distance_to_atmosphere);\n\t}\n\n\tlet sample_count = max(1.0, f32(global_id.z + 1) * 2.0);\n\tlet ss = integrate_scattered_luminance(uv, world_pos, world_dir, atmosphere, config, sample_count, t_max);\n\n\tlet transmittance = dot(ss.transmittance, vec3<f32>(1.0 / 3.0));\n\ttextureStore(aerial_perspective_lut, global_id, vec4<f32>(ss.luminance, 1.0 - transmittance));\n}\n";

var renderSkyWithLutsWgsl = "/*\n * Copyright (c) 2024 Lukas Herzberger\n * Copyright (c) 2020 Epic Games, Inc.\n * SPDX-License-Identifier: MIT\n */\n\noverride USE_MOON: bool = false;\n\noverride WORKGROUP_SIZE_X: u32 = 16;\noverride WORKGROUP_SIZE_Y: u32 = 16;\n\n@group(0) @binding(0) var<uniform> atmosphere_buffer: Atmosphere;\n@group(0) @binding(1) var<uniform> config_buffer: Uniforms;\n@group(0) @binding(2) var lut_sampler: sampler;\n@group(0) @binding(3) var transmittance_lut: texture_2d<f32>;\n@group(0) @binding(4) var sky_view_lut: texture_2d<f32>;\n@group(0) @binding(5) var aerial_perspective_lut : texture_3d<f32>;\n@group(0) @binding(6) var depth_buffer: texture_2d<f32>;\n@group(0) @binding(7) var backbuffer: texture_2d<f32>;\n@group(0) @binding(8) var render_target: texture_storage_2d<rgba16float, write>;\n\nfn use_sky_view_lut(view_height: f32, world_pos: vec3<f32>, world_dir: vec3<f32>, sun_dir: vec3<f32>, atmosphere: Atmosphere, config: Uniforms) -> vec4<f32> {\n\tlet zenith = normalize(world_pos);\n\tlet cos_view_zenith = dot(world_dir, zenith);\n\n\tlet side = normalize(cross(zenith, world_dir));\t// assumes non parallel vectors\n\tlet forward = normalize(cross(side, zenith));\t// aligns toward the sun light but perpendicular to up vector\n\tlet cos_light_view = normalize(vec2<f32>(dot(sun_dir, forward), dot(sun_dir, side))).x;\n\n\tlet intersects_ground = ray_intersects_sphere(world_pos, world_dir, vec3<f32>(), atmosphere.bottom_radius);\n\n\tlet uv = sky_view_lut_params_to_uv(atmosphere, intersects_ground, cos_view_zenith, cos_light_view, view_height);\n\n\tlet sky_view = textureSampleLevel(sky_view_lut, lut_sampler, uv, 0);\n\n\treturn vec4<f32>(sky_view.rgb + get_sun_luminance(world_pos, world_dir, atmosphere, config), sky_view.a);\n}\n\nfn render_sky(pix: vec2<u32>) -> vec4<f32> {\n\tlet atmosphere = atmosphere_buffer;\n\tlet config = config_buffer;\n\n\tlet uv = (vec2<f32>(pix) + 0.5) / vec2<f32>(config.screen_resolution);\n\n\tlet world_dir = uv_to_world_dir(uv, config.inverse_projection, config.inverse_view);\n\tvar world_pos = (config.camera_world_position * TO_KM_SCALE) - atmosphere.planet_center;\n\tlet sun_dir = normalize(config.sun.direction);\n\n\tlet view_height = length(world_pos);\n\t\n\tlet depth = textureLoad(depth_buffer, pix, 0).r;\n\tif !is_valid_depth(depth) {\n\t\treturn use_sky_view_lut(view_height, world_pos, world_dir, sun_dir, atmosphere, config);\n\t}\n\n\tlet depth_buffer_world_pos = uv_and_depth_to_world_pos(uv, config.inverse_projection, config.inverse_view, depth);\n\tlet t_depth = length(depth_buffer_world_pos - (world_pos + atmosphere.planet_center));\n\n\tvar slice = aerial_perspective_depth_to_slice(t_depth);\n\tvar weight = 1.0;\n\tif slice < 0.5 {\n\t\t// We multiply by weight to fade to 0 at depth 0. That works for luminance and opacity.\n\t\tweight = saturate(slice * 2.0);\n\t\tslice = 0.5;\n\t}\n\tlet w = sqrt(slice / AP_SLICE_COUNT);\t// squared distribution\n\n\tlet aerial_perspective = textureSampleLevel(aerial_perspective_lut, lut_sampler, vec3<f32>(uv, w), 0);\n\n\tif all(aerial_perspective.rgb == vec3<f32>())  {\n\t\treturn vec4<f32>();\n\t}\n\n\treturn weight * aerial_perspective;\n}\n\nstruct RenderSkyFragment {\n\t@location(0) luminance: vec4<f32>,\n\t@location(1) transmittance: vec4<f32>,\n}\n\n@fragment\nfn fragment(@builtin(position) coord: vec4<f32>) -> RenderSkyFragment {\n\tlet result = render_sky(vec2<u32>(floor(coord.xy)));\n\treturn RenderSkyFragment(vec4<f32>(result.rgb, 1.0), vec4<f32>(vec3<f32>(result.a), 1.0));\n}\n\n@compute\n@workgroup_size(WORKGROUP_SIZE_X, WORKGROUP_SIZE_Y, 1)\nfn render_sky_atmosphere(@builtin(global_invocation_id) global_id: vec3<u32>) {\n\tlet output_size = vec2<u32>(textureDimensions(render_target));\n\tif output_size.x <= global_id.x || output_size.y <= global_id.y {\n\t\treturn;\n\t}\n\tblend(global_id.xy, render_sky(global_id.xy));\n}\n\n";

var renderSkyRaymarchingWgsl = "/*\n * Copyright (c) 2024 Lukas Herzberger\n * Copyright (c) 2020 Epic Games, Inc.\n * SPDX-License-Identifier: MIT\n */\n\noverride USE_MOON: bool = false;\noverride INV_DISTANCE_TO_MAX_SAMPLE_COUNT: f32 = 1.0 / 100.0;\noverride USE_COLORED_TRANSMISSION: bool = true;\n\noverride WORKGROUP_SIZE_X: u32 = 16;\noverride WORKGROUP_SIZE_Y: u32 = 16;\n\n@group(0) @binding(0) var<uniform> atmosphere_buffer: Atmosphere;\n@group(0) @binding(1) var<uniform> config_buffer: Uniforms;\n@group(0) @binding(2) var lut_sampler: sampler;\n@group(0) @binding(3) var transmittance_lut: texture_2d<f32>;\n@group(0) @binding(4) var multi_scattering_lut: texture_2d<f32>;\n@group(0) @binding(5) var depth_buffer: texture_2d<f32>;\n@group(0) @binding(6) var backbuffer: texture_2d<f32>;\n@group(0) @binding(7) var render_target: texture_storage_2d<rgba16float, write>;\n\nstruct SingleScatteringResult {\n\tluminance: vec3<f32>,\t\t\t\t// Scattered light (luminance)\n\ttransmittance: vec3<f32>,\t\t\t// transmittance in [0,1] (unitless)\n}\n\nfn integrate_scattered_luminance(uv: vec2<f32>, world_pos: vec3<f32>, world_dir: vec3<f32>, atmosphere: Atmosphere, depth: f32, config: Uniforms) -> SingleScatteringResult {\n\tvar result = SingleScatteringResult();\n\n\tlet planet_center = vec3<f32>();\n\tvar t_max: f32 = 0.0;\n\tif !find_atmosphere_t_max(&t_max, world_pos, world_dir, planet_center, atmosphere.bottom_radius, atmosphere.top_radius) {\n\t\treturn result;\n\t}\n\n\tif is_valid_depth(depth) {\n\t\tlet depth_buffer_world_pos = uv_and_depth_to_world_pos(uv, config.inverse_projection, config.inverse_view, depth);\n\t\tt_max = min(t_max, length(depth_buffer_world_pos - (world_pos + atmosphere.planet_center)));\n\t}\n\tt_max = min(t_max, t_max_max);\n\n\tlet sample_count = mix(config.ray_march_min_spp, config.ray_march_max_spp, saturate(t_max * INV_DISTANCE_TO_MAX_SAMPLE_COUNT));\n\tlet sample_count_floored = floor(sample_count);\n\tlet inv_sample_count_floored = 1.0 / sample_count_floored;\n\tlet t_max_floored = t_max * sample_count_floored / sample_count;\n\tlet sample_segment_t = get_sample_segment_t(uv, config);\n\n\tlet sun_direction = normalize(config.sun.direction);\n\tlet sun_illuminance = config.sun.illuminance;\n\n\tlet cos_theta = dot(sun_direction, world_dir);\n\tlet mie_phase_val = mie_phase(cos_theta, atmosphere.mie_phase_param);\n\tlet rayleigh_phase_val = rayleigh_phase(cos_theta);\n\n\tvar moon_direction = config.moon.direction;\n\tvar moon_illuminance = config.moon.illuminance;\n\n\tvar cos_theta_moon = 0.0;\n\tvar mie_phase_val_moon = 0.0;\n\tvar rayleigh_phase_val_moon = 0.0;\n\n\tif USE_MOON {\n\t\tmoon_direction = normalize(moon_direction);\n\t\tmoon_illuminance = config.moon.illuminance;\n\n\t\tcos_theta_moon = dot(moon_direction, world_dir);\n\t\tmie_phase_val_moon = mie_phase(cos_theta_moon, atmosphere.mie_phase_param);\n\t\trayleigh_phase_val_moon = rayleigh_phase(cos_theta_moon);\n\t}\n\n\tresult.luminance = vec3<f32>(0.0);\n\tresult.transmittance = vec3<f32>(1.0);\n\tvar t = 0.0;\n\tvar dt = 0.0;\n\tfor (var s = 0.0; s < sample_count; s += 1.0) {\n\t\tvar t0 = s * inv_sample_count_floored;\n\t\tvar t1 = (s + 1.0) * inv_sample_count_floored;\n\t\tt0 = (t0 * t0) * t_max_floored;\n\t\tt1 = t1 * t1;\n\t\tif t1 > 1.0 {\n\t\t\tt1 = t_max;\n\t\t} else {\n\t\t\tt1 = t_max_floored * t1;\n\t\t}\n\t\tdt = t1 - t0;\n\t\tt = t0 + dt * sample_segment_t;\n\n\t\tlet sample_pos = world_pos + t * world_dir;\n\t\tlet sample_height= length(sample_pos);\n\n\t\tlet medium = sample_medium(sample_height - atmosphere.bottom_radius, atmosphere);\n\t\tlet sample_transmittance = exp(-medium.extinction * dt);\n\n\t\tlet zenith = sample_pos / sample_height;\n \n\t\tlet cos_sun_zenith = dot(sun_direction, zenith);\n\t\tlet transmittance_to_sun = textureSampleLevel(transmittance_lut, lut_sampler, transmittance_lut_params_to_uv(atmosphere, sample_height, cos_sun_zenith), 0).rgb;\n\t\tlet phase_times_scattering = medium.mie_scattering * mie_phase_val + medium.rayleigh_scattering * rayleigh_phase_val;\n\t\tlet multi_scattered_luminance = get_multiple_scattering(atmosphere, medium.scattering, medium.extinction, sample_pos, cos_sun_zenith);\n\t\tlet planet_shadow = compute_planet_shadow(sample_pos, sun_direction, planet_center + planet_radius_offset * zenith, atmosphere.bottom_radius);\n\t\tlet shadow = get_sample_shadow(atmosphere, sample_pos, 0);\n\n\t\tvar scattered_luminance = sun_illuminance * (planet_shadow * shadow * transmittance_to_sun * phase_times_scattering + multi_scattered_luminance * medium.scattering);\n\n\t\tif USE_MOON {\n\t\t\tlet cos_moon_zenith = dot(moon_direction, zenith);\n\t\t\tlet transmittance_to_moon = textureSampleLevel(transmittance_lut, lut_sampler, transmittance_lut_params_to_uv(atmosphere, sample_height, cos_moon_zenith), 0).rgb;\n\t\t\tlet phase_times_scattering_moon = medium.mie_scattering * mie_phase_val_moon + medium.rayleigh_scattering * rayleigh_phase_val_moon;\n\t\t\tlet multi_scattered_luminance_moon = get_multiple_scattering(atmosphere, medium.scattering, medium.extinction, sample_pos, cos_moon_zenith);\n\t\t\tlet planet_shadow_moon = compute_planet_shadow(sample_pos, moon_direction, planet_center + planet_radius_offset * zenith, atmosphere.bottom_radius);\n\t\t\tlet shadow_moon = get_sample_shadow(atmosphere, sample_pos, 1);\n\n\t\t\tscattered_luminance += moon_illuminance * (planet_shadow_moon * shadow_moon * transmittance_to_moon * phase_times_scattering_moon + multi_scattered_luminance_moon * medium.scattering);\n\t\t}\n\n\t\tlet intergrated_luminance = (scattered_luminance - scattered_luminance * sample_transmittance) / medium.extinction;\n\t\tresult.luminance += result.transmittance * intergrated_luminance;\n\t\tresult.transmittance *= sample_transmittance;\n\t}\n\n\treturn result;\n}\n\nstruct RenderSkyResult {\n\tluminance: vec4<f32>,\n\ttransmittance: vec4<f32>,\n}\n\nfn render_sky(pix: vec2<u32>) -> RenderSkyResult {\n\tlet atmosphere = atmosphere_buffer;\n\tlet config = config_buffer;\n\n\tlet uv = (vec2<f32>(pix) + 0.5) / vec2<f32>(config.screen_resolution);\n\n\tlet world_dir = uv_to_world_dir(uv, config.inverse_projection, config.inverse_view);\n\tvar world_pos = (config.camera_world_position * TO_KM_SCALE) - atmosphere.planet_center;\n\tlet sun_dir = normalize(config.sun.direction);\n\n\tlet view_height = length(world_pos);\n\t\n\tvar luminance = vec3<f32>();\n\t\n\tlet depth = textureLoad(depth_buffer, pix, 0).r;\n\tif !is_valid_depth(depth) {\n\t\tluminance += get_sun_luminance(world_pos, world_dir, atmosphere, config);\n\t}\n\n\tif !move_to_atmosphere_top(&world_pos, world_dir, atmosphere.top_radius) {\n\t\tluminance = get_sun_luminance(world_pos, world_dir, atmosphere, config);\n\t\treturn RenderSkyResult(max(vec4<f32>(luminance, 1.0), vec4<f32>()), max(vec4<f32>(0.0, 0.0, 0.0, 1.0), vec4<f32>()));\n\t}\n\t\n\tlet ss = integrate_scattered_luminance(uv, world_pos, world_dir, atmosphere, depth, config);\n\tluminance += ss.luminance;\n\n\treturn RenderSkyResult(max(vec4<f32>(luminance, 1.0), vec4<f32>()), max(vec4<f32>(ss.transmittance, 1.0), vec4<f32>()));\n}\n\nstruct RenderSkyFragment {\n\t@location(0) luminance: vec4<f32>,\n\t@location(1) transmittance: vec4<f32>,\n}\n\n@fragment\nfn fragment(@builtin(position) coord: vec4<f32>) -> RenderSkyFragment {\n\tlet result = render_sky(vec2<u32>(floor(coord.xy)));\n\treturn RenderSkyFragment(result.luminance, result.transmittance);\n}\n\n@compute\n@workgroup_size(WORKGROUP_SIZE_X, WORKGROUP_SIZE_Y)\nfn render_sky_atmosphere(@builtin(global_invocation_id) global_id: vec3<u32>) {\n\tlet output_size = vec2<u32>(textureDimensions(render_target));\n\tif output_size.x <= global_id.x || output_size.y <= global_id.y {\n\t\treturn;\n\t}\n\tlet result = render_sky(global_id.xy);\n\tif USE_COLORED_TRANSMISSION {\n\t\tdual_source_blend(global_id.xy, result.luminance, result.transmittance);\n\t} else {\n\t\tblend(global_id.xy, vec4<f32>(result.luminance.rgb, 1.0 - dot(result.transmittance.rgb, vec3<f32>(1.0 / 3.0))));\n\t}\n}\n\n";

var renderSkyLutAndRaymarchingWgsl = "/*\n * Copyright (c) 2024 Lukas Herzberger\n * Copyright (c) 2020 Epic Games, Inc.\n * SPDX-License-Identifier: MIT\n */\n\noverride USE_MOON: bool = false;\noverride INV_DISTANCE_TO_MAX_SAMPLE_COUNT: f32 = 1.0 / 100.0;\noverride USE_COLORED_TRANSMISSION: bool = true;\n\noverride WORKGROUP_SIZE_X: u32 = 16;\noverride WORKGROUP_SIZE_Y: u32 = 16;\n\n@group(0) @binding(0) var<uniform> atmosphere_buffer: Atmosphere;\n@group(0) @binding(1) var<uniform> config_buffer: Uniforms;\n@group(0) @binding(2) var lut_sampler: sampler;\n@group(0) @binding(3) var transmittance_lut: texture_2d<f32>;\n@group(0) @binding(4) var multi_scattering_lut: texture_2d<f32>;\n@group(0) @binding(5) var sky_view_lut: texture_2d<f32>;\n@group(0) @binding(6) var depth_buffer: texture_2d<f32>;\n@group(0) @binding(7) var backbuffer: texture_2d<f32>;\n@group(0) @binding(8) var render_target: texture_storage_2d<rgba16float, write>;\n\nfn use_sky_view_lut(view_height: f32, world_pos: vec3<f32>, world_dir: vec3<f32>, sun_dir: vec3<f32>, atmosphere: Atmosphere, config: Uniforms) -> vec4<f32> {\n\tlet zenith = normalize(world_pos);\n\tlet cos_view_zenith = dot(world_dir, zenith);\n\n\tlet side = normalize(cross(zenith, world_dir));\t// assumes non parallel vectors\n\tlet forward = normalize(cross(side, zenith));\t// aligns toward the sun light but perpendicular to up vector\n\tlet cos_light_view = normalize(vec2<f32>(dot(sun_dir, forward), dot(sun_dir, side))).x;\n\n\tlet intersects_ground = ray_intersects_sphere(world_pos, world_dir, vec3<f32>(), atmosphere.bottom_radius);\n\n\tlet uv = sky_view_lut_params_to_uv(atmosphere, intersects_ground, cos_view_zenith, cos_light_view, view_height);\n\n\tlet sky_view = textureSampleLevel(sky_view_lut, lut_sampler, uv, 0);\n\n\treturn vec4<f32>(sky_view.rgb + get_sun_luminance(world_pos, world_dir, atmosphere, config), sky_view.a);\n}\n\nstruct SingleScatteringResult {\n\tluminance: vec3<f32>,\t\t\t\t// Scattered light (luminance)\n\ttransmittance: vec3<f32>,\t\t\t// transmittance in [0,1] (unitless)\n}\n\nfn integrate_scattered_luminance(uv: vec2<f32>, world_pos: vec3<f32>, world_dir: vec3<f32>, atmosphere: Atmosphere, depth: f32, config: Uniforms) -> SingleScatteringResult {\n\tvar result = SingleScatteringResult();\n\n\tlet planet_center = vec3<f32>();\n\tvar t_max: f32 = 0.0;\n\tif !find_atmosphere_t_max(&t_max, world_pos, world_dir, planet_center, atmosphere.bottom_radius, atmosphere.top_radius) {\n\t\treturn result;\n\t}\n\n\tif is_valid_depth(depth) {\n\t\tlet depth_buffer_world_pos = uv_and_depth_to_world_pos(uv, config.inverse_projection, config.inverse_view, depth);\n\t\tt_max = min(t_max, length(depth_buffer_world_pos - (world_pos + atmosphere.planet_center)));\n\t}\n\tt_max = min(t_max, t_max_max);\n\n\tlet sample_count = mix(config.ray_march_min_spp, config.ray_march_max_spp, saturate(t_max * INV_DISTANCE_TO_MAX_SAMPLE_COUNT));\n\tlet sample_count_floored = floor(sample_count);\n\tlet inv_sample_count_floored = 1.0 / sample_count_floored;\n\tlet t_max_floored = t_max * sample_count_floored / sample_count;\n\tlet sample_segment_t = get_sample_segment_t(uv, config);\n\n\tlet sun_direction = normalize(config.sun.direction);\n\tlet sun_illuminance = config.sun.illuminance;\n\n\tlet cos_theta = dot(sun_direction, world_dir);\n\tlet mie_phase_val = mie_phase(cos_theta, atmosphere.mie_phase_param);\n\tlet rayleigh_phase_val = rayleigh_phase(cos_theta);\n\n\tvar moon_direction = config.moon.direction;\n\tvar moon_illuminance = config.moon.illuminance;\n\n\tvar cos_theta_moon = 0.0;\n\tvar mie_phase_val_moon = 0.0;\n\tvar rayleigh_phase_val_moon = 0.0;\n\n\tif USE_MOON {\n\t\tmoon_direction = normalize(moon_direction);\n\t\tmoon_illuminance = config.moon.illuminance;\n\n\t\tcos_theta_moon = dot(moon_direction, world_dir);\n\t\tmie_phase_val_moon = mie_phase(cos_theta_moon, atmosphere.mie_phase_param);\n\t\trayleigh_phase_val_moon = rayleigh_phase(cos_theta_moon);\n\t}\n\n\tresult.luminance = vec3<f32>(0.0);\n\tresult.transmittance = vec3<f32>(1.0);\n\tvar t = 0.0;\n\tvar dt = 0.0;\n\tfor (var s = 0.0; s < sample_count; s += 1.0) {\n\t\tvar t0 = s * inv_sample_count_floored;\n\t\tvar t1 = (s + 1.0) * inv_sample_count_floored;\n\t\tt0 = (t0 * t0) * t_max_floored;\n\t\tt1 = t1 * t1;\n\t\tif t1 > 1.0 {\n\t\t\tt1 = t_max;\n\t\t} else {\n\t\t\tt1 = t_max_floored * t1;\n\t\t}\n\t\tdt = t1 - t0;\n\t\tt = t0 + dt * sample_segment_t;\n\n\t\tlet sample_pos = world_pos + t * world_dir;\n\t\tlet sample_height= length(sample_pos);\n\n\t\tlet medium = sample_medium(sample_height - atmosphere.bottom_radius, atmosphere);\n\t\tlet sample_transmittance = exp(-medium.extinction * dt);\n\n\t\tlet zenith = sample_pos / sample_height;\n \n\t\tlet cos_sun_zenith = dot(sun_direction, zenith);\n\t\tlet transmittance_to_sun = textureSampleLevel(transmittance_lut, lut_sampler, transmittance_lut_params_to_uv(atmosphere, sample_height, cos_sun_zenith), 0).rgb;\n\t\tlet phase_times_scattering = medium.mie_scattering * mie_phase_val + medium.rayleigh_scattering * rayleigh_phase_val;\n\t\tlet multi_scattered_luminance = get_multiple_scattering(atmosphere, medium.scattering, medium.extinction, sample_pos, cos_sun_zenith);\n\t\tlet planet_shadow = compute_planet_shadow(sample_pos, sun_direction, planet_center + planet_radius_offset * zenith, atmosphere.bottom_radius);\n\t\tlet shadow = get_sample_shadow(atmosphere, sample_pos, 0);\n\n\t\tvar scattered_luminance = sun_illuminance * (planet_shadow * shadow * transmittance_to_sun * phase_times_scattering + multi_scattered_luminance * medium.scattering);\n\n\t\tif USE_MOON {\n\t\t\tlet cos_moon_zenith = dot(moon_direction, zenith);\n\t\t\tlet transmittance_to_moon = textureSampleLevel(transmittance_lut, lut_sampler, transmittance_lut_params_to_uv(atmosphere, sample_height, cos_moon_zenith), 0).rgb;\n\t\t\tlet phase_times_scattering_moon = medium.mie_scattering * mie_phase_val_moon + medium.rayleigh_scattering * rayleigh_phase_val_moon;\n\t\t\tlet multi_scattered_luminance_moon = get_multiple_scattering(atmosphere, medium.scattering, medium.extinction, sample_pos, cos_moon_zenith);\n\t\t\tlet planet_shadow_moon = compute_planet_shadow(sample_pos, moon_direction, planet_center + planet_radius_offset * zenith, atmosphere.bottom_radius);\n\t\t\tlet shadow_moon = get_sample_shadow(atmosphere, sample_pos, 1);\n\n\t\t\tscattered_luminance += moon_illuminance * (planet_shadow_moon * shadow_moon * transmittance_to_moon * phase_times_scattering_moon + multi_scattered_luminance_moon * medium.scattering);\n\t\t}\n\n\t\tlet intergrated_luminance = (scattered_luminance - scattered_luminance * sample_transmittance) / medium.extinction;\n\t\tresult.luminance += result.transmittance * intergrated_luminance;\n\t\tresult.transmittance *= sample_transmittance;\n\t}\n\n\treturn result;\n}\n\nstruct RenderSkyResult {\n\tluminance: vec4<f32>,\n\ttransmittance: vec4<f32>,\n}\n\nfn render_sky(pix: vec2<u32>) -> RenderSkyResult {\n\tlet atmosphere = atmosphere_buffer;\n\tlet config = config_buffer;\n\n\tlet uv = (vec2<f32>(pix) + 0.5) / vec2<f32>(config.screen_resolution);\n\n\tlet world_dir = uv_to_world_dir(uv, config.inverse_projection, config.inverse_view);\n\tvar world_pos = (config.camera_world_position * TO_KM_SCALE)- atmosphere.planet_center;\n\tlet sun_dir = normalize(config.sun.direction);\n\n\tlet view_height = length(world_pos);\n\n\tlet depth = textureLoad(depth_buffer, pix, 0).r;\n\tif !is_valid_depth(depth) {\n\t\tlet sky_view = use_sky_view_lut(view_height, world_pos, world_dir, sun_dir, atmosphere, config);\n\t\treturn RenderSkyResult(vec4<f32>(sky_view.rgb, 1.0), vec4<f32>(vec3<f32>(sky_view.a), 1.0));\n\t}\n\t\n\tif !move_to_atmosphere_top(&world_pos, world_dir, atmosphere.top_radius) {\n\t\tlet black = vec4<f32>(vec3<f32>(), 1.0);\n\t\treturn RenderSkyResult(black, black);\n\t}\n\t\n\tlet ss = integrate_scattered_luminance(uv, world_pos, world_dir, atmosphere, depth, config);\n\n\treturn RenderSkyResult(max(vec4<f32>(ss.luminance, 1.0), vec4<f32>()), max(vec4<f32>(ss.transmittance, 1.0), vec4<f32>()));\n}\n\nstruct RenderSkyFragment {\n\t@location(0) luminance: vec4<f32>,\n\t@location(1) transmittance: vec4<f32>,\n}\n\n@fragment\nfn fragment(@builtin(position) coord: vec4<f32>) -> RenderSkyFragment {\n\tlet result = render_sky(vec2<u32>(floor(coord.xy)));\n\treturn RenderSkyFragment(result.luminance, result.transmittance);\n}\n\n@compute\n@workgroup_size(WORKGROUP_SIZE_X, WORKGROUP_SIZE_Y)\nfn render_sky_atmosphere(@builtin(global_invocation_id) global_id: vec3<u32>) {\n\tlet output_size = vec2<u32>(textureDimensions(render_target));\n\tif output_size.x <= global_id.x || output_size.y <= global_id.y {\n\t\treturn;\n\t}\n\tlet result = render_sky(global_id.xy);\n\tif USE_COLORED_TRANSMISSION {\n\t\tdual_source_blend(global_id.xy, result.luminance, result.transmittance);\n\t} else {\n\t\tblend(global_id.xy, vec4<f32>(result.luminance.rgb, 1.0 - dot(result.transmittance.rgb, vec3<f32>(1.0 / 3.0))));\n\t}\n}\n\n";

/*
 * Copyright (c) 2024 Lukas Herzberger
 * SPDX-License-Identifier: MIT
 */
function makePhaseShaderCode(constDropletDiameter) {
    const base = phaseWgsl.replace('// include hg_draine_const', hgDraineConstWgsl);
    if (!constDropletDiameter || constDropletDiameter >= 5.0) {
        return base.replace('// include hg_draine_size', hgDraineLargeWgsl);
    }
    else if (constDropletDiameter >= 1.5) {
        return base.replace('// include hg_draine_size', hgDraineMid2Wgsl);
    }
    else if (constDropletDiameter > 0.1) {
        return base.replace('// include hg_draine_size', hgDraineMid1Wgsl);
    }
    else {
        return base.replace('// include hg_draine_size', hgDraineSmallWgsl);
    }
}
function makeTransmittanceLutShaderCode(transmittanceLutFormat = 'rgba16float') {
    return `${constantsWgsl}\n${intersectionWgsl}\n${mediumWgsl}\n${renderTransmittanceLutWgsl}`.replace('rgba16float', transmittanceLutFormat);
}
function makeMultiScatteringLutShaderCode(multiScatteringLutFormat = 'rgba16float') {
    return `${constantsWgsl}\n${intersectionWgsl}\n${mediumWgsl}\n${makePhaseShaderCode()}\n${uvWgsl}\n${renderMultiScatteringLutWgsl}`.replace('rgba16float', multiScatteringLutFormat);
}
function makeShadowShaderCode(shadow) {
    return `${shadow ?? 'fn get_shadow(p: vec3<f32>, i: u32) -> f32 { return 1.0; }'}\n${shadowBaseWgsl}`;
}
function makeSkyViewLutShaderCode(skyViewLutFormat = 'rgba16float', shadow, customUniforms, constDropletDiameter) {
    const base = `${constantsWgsl}\n${intersectionWgsl}\n${mediumWgsl}\n${makePhaseShaderCode(constDropletDiameter)}\n${uvWgsl}\n${uniformsWgsl}\n${customUniforms ? `${customUniforms}\n${customUniformsWgsl}\n` : ''}${coordinateSystemWgsl}\n${multipleScatteringWgsl}\n`;
    let shader = renderSkyViewLutWgsl.replace('rgba16float', skyViewLutFormat);
    if (customUniforms) {
        shader = shader.replace('let config = config_buffer', 'let config = get_uniforms()');
        shader = shader.replace('@group(0) @binding(1) var<uniform> config_buffer: Uniforms;', '');
        for (let i = 2; i < 6; ++i) {
            shader = shader.replace(`group(0) @binding(${i})`, `group(0) @binding(${i - 1})`);
        }
    }
    return `${makeShadowShaderCode(shadow)}\n${base}\n${shader}`;
}
function makeAerialPerspectiveLutShaderCode(aerialPerspectiveLutFormat = 'rgba16float', shadow, customUniforms, constDropletDiameter) {
    const base = `${constantsWgsl}\n${intersectionWgsl}\n${mediumWgsl}\n${makePhaseShaderCode(constDropletDiameter)}\n${uvWgsl}\n${uniformsWgsl}\n${customUniforms ? `${customUniforms}\n${customUniformsWgsl}\n` : ''}${coordinateSystemWgsl}\n${multipleScatteringWgsl}\n${aerialPerspectiveWgsl}\n${sampleSegmentWgsl}\n`;
    let shader = renderAerialPerspectiveWgsl.replace('rgba16float', aerialPerspectiveLutFormat);
    if (customUniforms) {
        shader = shader.replace('let config = config_buffer', 'let config = get_uniforms()');
        shader = shader.replace('@group(0) @binding(1) var<uniform> config_buffer: Uniforms;', '');
        for (let i = 2; i < 6; ++i) {
            shader = shader.replace(`group(0) @binding(${i})`, `group(0) @binding(${i - 1})`);
        }
    }
    return `${makeShadowShaderCode(shadow)}\n${base}\n${shader}`;
}
function makeRenderSkyWithLutsShaderCode(renderTargetFormat = 'rgba16float', customUniforms) {
    const base = `${constantsWgsl}\n${intersectionWgsl}\n${mediumWgsl}\n${uvWgsl}\n${uniformsWgsl}\n${customUniforms ? `${customUniforms}\n${customUniformsWgsl}\n` : ''}${coordinateSystemWgsl}\n${aerialPerspectiveWgsl}\n${skyViewWgsl}\n${blendWgsl}\n${sunDiskWgsl}\n${fullScreenVertexShaderWgsl}\n${sampleSegmentWgsl}\n`;
    let shader = renderSkyWithLutsWgsl.replace('rgba16float', renderTargetFormat);
    if (customUniforms) {
        shader = shader.replace('let config = config_buffer', 'let config = get_uniforms()');
        shader = shader.replace('@group(0) @binding(1) var<uniform> config_buffer: Uniforms;', '');
        for (let i = 2; i < 9; ++i) {
            shader = shader.replace(`group(0) @binding(${i})`, `group(0) @binding(${i - 1})`);
        }
    }
    return `${base}\n${shader}`;
}
function makeRenderSkyRaymarchingShaderCode(renderTargetFormat = 'rgba16float', shadow, customUniforms, constDropletDiameter) {
    const base = `${constantsWgsl}\n${intersectionWgsl}\n${mediumWgsl}\n${makePhaseShaderCode(constDropletDiameter)}\n${uvWgsl}\n${uniformsWgsl}\n${customUniforms ? `${customUniforms}\n${customUniformsWgsl}\n` : ''}${coordinateSystemWgsl}\n${multipleScatteringWgsl}\n${blendWgsl}\n${sunDiskWgsl}\n${fullScreenVertexShaderWgsl}\n${sampleSegmentWgsl}\n`;
    let shader = renderSkyRaymarchingWgsl.replace('rgba16float', renderTargetFormat);
    if (customUniforms) {
        shader = shader.replace('let config = config_buffer', 'let config = get_uniforms()');
        shader = shader.replace('@group(0) @binding(1) var<uniform> config_buffer: Uniforms;', '');
        for (let i = 2; i < 9; ++i) {
            shader = shader.replace(`group(0) @binding(${i})`, `group(0) @binding(${i - 1})`);
        }
    }
    return `${makeShadowShaderCode(shadow)}\n${base}\n${shader}`;
}
function makeRenderSkyLutAndRaymarchingShaderCode(renderTargetFormat = 'rgba16float', shadow, customUniforms, constDropletDiameter) {
    const base = `${constantsWgsl}\n${intersectionWgsl}\n${mediumWgsl}\n${makePhaseShaderCode(constDropletDiameter)}\n${uvWgsl}\n${uniformsWgsl}\n${customUniforms ? `${customUniforms}\n${customUniformsWgsl}\n` : ''}${coordinateSystemWgsl}\n${multipleScatteringWgsl}\n${skyViewWgsl}\n${blendWgsl}\n${sunDiskWgsl}\n${fullScreenVertexShaderWgsl}\n${sampleSegmentWgsl}\n`;
    let shader = renderSkyLutAndRaymarchingWgsl.replace('rgba16float', renderTargetFormat);
    if (customUniforms) {
        shader = shader.replace('let config = config_buffer', 'let config = get_uniforms()');
        shader = shader.replace('@group(0) @binding(1) var<uniform> config_buffer: Uniforms;', '');
        for (let i = 2; i < 9; ++i) {
            shader = shader.replace(`group(0) @binding(${i})`, `group(0) @binding(${i - 1})`);
        }
    }
    return `${makeShadowShaderCode(shadow)}\n${base}\n${shader}`;
}

/*
 * Copyright (c) 2024 Lukas Herzberger
 * SPDX-License-Identifier: MIT
 */
const DEFAULT_TRANSMITTANCE_LUT_SAMPLE_COUNT = 40;
const DEFAULT_MULTI_SCATTERING_LUT_SAMPLE_COUNT = 20;
const MULTI_SCATTERING_LUT_MIN_SAMPLE_COUNT = 10;
class TransmittanceLutPipeline {
    device;
    pipeline;
    bindGroupLayout;
    transmittanceLutFormat;
    constructor(device, pipeline, bindGroupLayout, transmittanceLutFormat) {
        this.device = device;
        this.pipeline = pipeline;
        this.bindGroupLayout = bindGroupLayout;
        this.transmittanceLutFormat = transmittanceLutFormat;
    }
    static makeBindGroupLayout(device, transmittanceLutFormat) {
        return device.createBindGroupLayout({
            label: 'transmittance LUT pass',
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {
                        type: 'uniform',
                        hasDynamicOffset: false,
                        minBindingSize: ATMOSPHERE_BUFFER_SIZE,
                    },
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    storageTexture: {
                        access: 'write-only',
                        format: transmittanceLutFormat,
                        viewDimension: '2d',
                    },
                },
            ],
        });
    }
    static makePipelineDescriptor(device, bindGroupLayout, transmittanceLutFormat, sampleCount) {
        return {
            label: 'transmittance LUT pass',
            layout: device.createPipelineLayout({
                label: 'transmittance LUT pass',
                bindGroupLayouts: [bindGroupLayout],
            }),
            compute: {
                module: device.createShaderModule({
                    code: makeTransmittanceLutShaderCode(transmittanceLutFormat),
                }),
                entryPoint: 'render_transmittance_lut',
                constants: {
                    SAMPLE_COUNT: Math.max(sampleCount, DEFAULT_TRANSMITTANCE_LUT_SAMPLE_COUNT),
                },
            },
        };
    }
    static async createAsync(device, transmittanceLutFormat, sampleCount) {
        const bindGroupLayout = this.makeBindGroupLayout(device, transmittanceLutFormat);
        const pipeline = await device.createComputePipelineAsync(this.makePipelineDescriptor(device, bindGroupLayout, transmittanceLutFormat, sampleCount));
        return new TransmittanceLutPipeline(device, pipeline, bindGroupLayout, transmittanceLutFormat);
    }
    static create(device, transmittanceLutFormat, sampleCount) {
        const bindGroupLayout = this.makeBindGroupLayout(device, transmittanceLutFormat);
        const pipeline = device.createComputePipeline(this.makePipelineDescriptor(device, bindGroupLayout, transmittanceLutFormat, sampleCount));
        return new TransmittanceLutPipeline(device, pipeline, bindGroupLayout, transmittanceLutFormat);
    }
    makeComputePass(resources) {
        if (this.device !== resources.device) {
            throw new Error(`[TransmittanceLutPipeline::makeComputePass]: device mismatch`);
        }
        if (resources.atmosphereBuffer.size < ATMOSPHERE_BUFFER_SIZE) {
            throw new Error(`[TransmittanceLutPipeline::makeComputePass]: buffer too small for atmosphere parameters (${resources.atmosphereBuffer.size} < ${ATMOSPHERE_BUFFER_SIZE})`);
        }
        if (resources.transmittanceLut.texture.format !== this.transmittanceLutFormat) {
            throw new Error(`[TransmittanceLutPipeline::makeComputePass]: wrong texture format for transmittance LUT. expected '${this.transmittanceLutFormat}', got ${resources.transmittanceLut.texture.format}`);
        }
        const bindGroup = resources.device.createBindGroup({
            label: `transmittance LUT pass [${resources.label}]`,
            layout: this.bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: resources.atmosphereBuffer,
                    },
                },
                {
                    binding: 1,
                    resource: resources.transmittanceLut.view,
                },
            ],
        });
        return new ComputePass(this.pipeline, [bindGroup], [Math.ceil(resources.transmittanceLut.texture.width / 16.0), Math.ceil(resources.transmittanceLut.texture.height / 16.0), 1]);
    }
}
class MultiScatteringLutPipeline {
    device;
    pipeline;
    bindGroupLayout;
    multiScatteringLutFormat;
    constructor(device, pipeline, bindGroupLayout, multiScatteringLutFormat) {
        this.device = device;
        this.pipeline = pipeline;
        this.bindGroupLayout = bindGroupLayout;
        this.multiScatteringLutFormat = multiScatteringLutFormat;
    }
    static makeBindGroupLayout(device, multiScatteringLutFormat) {
        return device.createBindGroupLayout({
            label: 'mulitple scattering LUT pass',
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {
                        type: 'uniform',
                        hasDynamicOffset: false,
                        minBindingSize: ATMOSPHERE_BUFFER_SIZE,
                    },
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    sampler: {
                        type: 'filtering',
                    },
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.COMPUTE,
                    texture: {
                        sampleType: 'float',
                        viewDimension: '2d',
                        multisampled: false,
                    },
                },
                {
                    binding: 3,
                    visibility: GPUShaderStage.COMPUTE,
                    storageTexture: {
                        access: 'write-only',
                        format: multiScatteringLutFormat,
                        viewDimension: '2d',
                    },
                },
            ],
        });
    }
    static makePipelineDescriptor(device, bindGroupLayout, multiScatteringLutFormat, sampleCount) {
        return {
            label: 'mulitple scattering LUT pass',
            layout: device.createPipelineLayout({
                label: 'mulitple scattering LUT pass',
                bindGroupLayouts: [bindGroupLayout],
            }),
            compute: {
                module: device.createShaderModule({
                    code: makeMultiScatteringLutShaderCode(multiScatteringLutFormat),
                }),
                entryPoint: 'render_multi_scattering_lut',
                constants: {
                    SAMPLE_COUNT: Math.max(sampleCount, MULTI_SCATTERING_LUT_MIN_SAMPLE_COUNT),
                },
            },
        };
    }
    static async createAsync(device, multiScatteringLutFormat, sampleCount) {
        const bindGroupLayout = this.makeBindGroupLayout(device, multiScatteringLutFormat);
        const pipeline = await device.createComputePipelineAsync(this.makePipelineDescriptor(device, bindGroupLayout, multiScatteringLutFormat, sampleCount));
        return new MultiScatteringLutPipeline(device, pipeline, bindGroupLayout, multiScatteringLutFormat);
    }
    static create(device, multiScatteringLutFormat, sampleCount) {
        const bindGroupLayout = this.makeBindGroupLayout(device, multiScatteringLutFormat);
        const pipeline = device.createComputePipeline(this.makePipelineDescriptor(device, bindGroupLayout, multiScatteringLutFormat, sampleCount));
        return new MultiScatteringLutPipeline(device, pipeline, bindGroupLayout, multiScatteringLutFormat);
    }
    makeComputePass(resources) {
        if (this.device !== resources.device) {
            throw new Error(`[MultiScatteringLutPipeline::makeComputePass]: device mismatch`);
        }
        if (resources.atmosphereBuffer.size < ATMOSPHERE_BUFFER_SIZE) {
            throw new Error(`[MultiScatteringLutPipeline::makeComputePass]: buffer too small for atmosphere parameters (${resources.atmosphereBuffer.size} < ${ATMOSPHERE_BUFFER_SIZE})`);
        }
        if (resources.multiScatteringLut.texture.format !== this.multiScatteringLutFormat) {
            throw new Error(`[MultiScatteringLutPipeline::makeComputePass]: wrong texture format for multiple scattering LUT. expected '${this.multiScatteringLutFormat}', got ${resources.multiScatteringLut.texture.format}`);
        }
        const bindGroup = resources.device.createBindGroup({
            label: `mulitple scattering LUT pass [${resources.label}]`,
            layout: this.bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: resources.atmosphereBuffer,
                    },
                },
                {
                    binding: 1,
                    resource: resources.lutSampler,
                },
                {
                    binding: 2,
                    resource: resources.transmittanceLut.view,
                },
                {
                    binding: 3,
                    resource: resources.multiScatteringLut.view,
                },
            ],
        });
        return new ComputePass(this.pipeline, [bindGroup], [resources.multiScatteringLut.texture.width, resources.multiScatteringLut.texture.height, 1]);
    }
}
function makeMiePhaseOverrides(miePhaseConfig) {
    if (!miePhaseConfig) {
        return {};
    }
    else {
        const mieOverrides = {
            MIE_USE_HG_DRAINE: Number(true),
        };
        if (!(miePhaseConfig.useConstantDropletDiameter ?? true)) {
            mieOverrides['MIE_USE_HG_DRAINE_DYNAMIC'] = Number(true);
        }
        else if (miePhaseConfig.constantDropletDiameter) {
            mieOverrides['HG_DRAINE_DROPLET_DIAMETER'] = miePhaseConfig.constantDropletDiameter;
        }
        return mieOverrides;
    }
}
class SkyViewLutPipeline {
    device;
    pipeline;
    bindGroupLayout;
    skyViewLutFormat;
    skyViewLutSize;
    multiscatteringLutSize;
    constructor(device, pipeline, bindGroupLayout, skyViewLutFormat, skyViewLutSize, multiscatteringLutSize) {
        this.device = device;
        this.pipeline = pipeline;
        this.bindGroupLayout = bindGroupLayout;
        this.skyViewLutFormat = skyViewLutFormat;
        this.skyViewLutSize = skyViewLutSize;
        this.multiscatteringLutSize = multiscatteringLutSize;
    }
    static makeBindGroupLayout(device, skyViewLutFormat, customUniformsConfig) {
        return device.createBindGroupLayout({
            label: 'sky view LUT pass',
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {
                        type: 'uniform',
                        hasDynamicOffset: false,
                        minBindingSize: ATMOSPHERE_BUFFER_SIZE,
                    },
                },
                customUniformsConfig ? undefined : {
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {
                        type: 'uniform',
                        hasDynamicOffset: false,
                        minBindingSize: UNIFORMS_BUFFER_SIZE,
                    },
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.COMPUTE,
                    sampler: {
                        type: 'filtering',
                    },
                },
                {
                    binding: 3,
                    visibility: GPUShaderStage.COMPUTE,
                    texture: {
                        sampleType: 'float',
                        viewDimension: '2d',
                        multisampled: false,
                    },
                },
                {
                    binding: 4,
                    visibility: GPUShaderStage.COMPUTE,
                    texture: {
                        sampleType: 'float',
                        viewDimension: '2d',
                        multisampled: false,
                    },
                },
                {
                    binding: 5,
                    visibility: GPUShaderStage.COMPUTE,
                    storageTexture: {
                        access: 'write-only',
                        format: skyViewLutFormat,
                        viewDimension: '2d',
                    },
                },
            ].filter(e => e !== undefined)
                .map((e, i) => {
                e.binding = i;
                return e;
            }),
        });
    }
    static makePipelineDescriptor(device, bindGroupLayout, skyViewLutFormat, skyViewLutSize, multiscatteringLutSize, distanceToMaxSampleCount, fromKilometersScaleFactor, useMoon, shadowConfig, customUniformsConfig, miePhaseConfig) {
        return {
            label: 'sky view LUT pass',
            layout: device.createPipelineLayout({
                label: 'sky view LUT pass',
                bindGroupLayouts: [bindGroupLayout, ...(shadowConfig?.bindGroupLayouts ?? []), ...(customUniformsConfig?.bindGroupLayouts ?? [])],
            }),
            compute: {
                module: device.createShaderModule({
                    label: 'sky view LUT',
                    code: makeSkyViewLutShaderCode(skyViewLutFormat, shadowConfig?.wgslCode, customUniformsConfig?.wgslCode, miePhaseConfig?.constantDropletDiameter),
                }),
                entryPoint: 'render_sky_view_lut',
                constants: {
                    SKY_VIEW_LUT_RES_X: skyViewLutSize[0],
                    SKY_VIEW_LUT_RES_Y: skyViewLutSize[1],
                    INV_DISTANCE_TO_MAX_SAMPLE_COUNT: 1.0 / distanceToMaxSampleCount,
                    MULTI_SCATTERING_LUT_RES_X: multiscatteringLutSize[0],
                    MULTI_SCATTERING_LUT_RES_Y: multiscatteringLutSize[1],
                    FROM_KM_SCALE: fromKilometersScaleFactor,
                    USE_MOON: Number(useMoon),
                    ...makeMiePhaseOverrides(miePhaseConfig),
                },
            },
        };
    }
    static async createAsync(device, skyViewLutFormat, skyViewLutSize, multiscatteringLutSize, distanceToMaxSampleCount, fromKilometersScaleFactor, useMoon, shadowConfig, customUniformsConfig, miePhaseConfig) {
        const bindGroupLayout = this.makeBindGroupLayout(device, skyViewLutFormat, customUniformsConfig);
        const pipeline = await device.createComputePipelineAsync(this.makePipelineDescriptor(device, bindGroupLayout, skyViewLutFormat, skyViewLutSize, multiscatteringLutSize, distanceToMaxSampleCount, fromKilometersScaleFactor, useMoon, shadowConfig, customUniformsConfig, miePhaseConfig));
        return new SkyViewLutPipeline(device, pipeline, bindGroupLayout, skyViewLutFormat, skyViewLutSize, multiscatteringLutSize);
    }
    static create(device, skyViewLutFormat, skyViewLutSize, multiscatteringLutSize, distanceToMaxSampleCount, fromKilometersScaleFactor, useMoon, shadowConfig, customUniformsConfig, miePhaseConfig) {
        const bindGroupLayout = this.makeBindGroupLayout(device, skyViewLutFormat, customUniformsConfig);
        const pipeline = device.createComputePipeline(this.makePipelineDescriptor(device, bindGroupLayout, skyViewLutFormat, skyViewLutSize, multiscatteringLutSize, distanceToMaxSampleCount, fromKilometersScaleFactor, useMoon, shadowConfig, customUniformsConfig, miePhaseConfig));
        return new SkyViewLutPipeline(device, pipeline, bindGroupLayout, skyViewLutFormat, skyViewLutSize, multiscatteringLutSize);
    }
    makeComputePass(resources, shadowBindGroups, customUniformsBindGroups) {
        if (this.device !== resources.device) {
            throw new Error(`[SkyViewLutPipeline::makeComputePass]: device mismatch`);
        }
        if (resources.atmosphereBuffer.size < ATMOSPHERE_BUFFER_SIZE) {
            throw new Error(`[SkyViewLutPipeline::makeComputePass]: buffer too small for atmosphere parameters (${resources.atmosphereBuffer.size} < ${ATMOSPHERE_BUFFER_SIZE})`);
        }
        if (resources.uniformsBuffer && resources.uniformsBuffer.size < UNIFORMS_BUFFER_SIZE) {
            throw new Error(`[SkyViewLutPipeline::makeComputePass]: buffer too small for config (${resources.atmosphereBuffer.size} < ${ATMOSPHERE_BUFFER_SIZE})`);
        }
        if (resources.multiScatteringLut.texture.width !== this.multiscatteringLutSize[0] || resources.multiScatteringLut.texture.height !== this.multiscatteringLutSize[1]) {
            throw new Error(`[SkyViewLutPipeline::makeComputePass]: wrong texture size for multiple scattering LUT. expected '${this.multiscatteringLutSize}', got ${[resources.multiScatteringLut.texture.width, resources.multiScatteringLut.texture.height]}`);
        }
        if (resources.skyViewLut.texture.format !== this.skyViewLutFormat) {
            throw new Error(`[SkyViewLutPipeline::makeComputePass]: wrong texture format for sky view LUT. expected '${this.skyViewLutFormat}', got ${resources.skyViewLut.texture.format}`);
        }
        if (resources.skyViewLut.texture.width !== this.skyViewLutSize[0] || resources.skyViewLut.texture.height !== this.skyViewLutSize[1]) {
            throw new Error(`[SkyViewLutPipeline::makeComputePass]: wrong texture size for sky view LUT. expected '${this.skyViewLutSize}', got ${[resources.skyViewLut.texture.width, resources.skyViewLut.texture.height]}`);
        }
        const bindGroup = resources.device.createBindGroup({
            label: `sky view LUT pass [${resources.label}]`,
            layout: this.bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: resources.atmosphereBuffer,
                    },
                },
                customUniformsBindGroups ? undefined : {
                    binding: 1,
                    resource: {
                        buffer: resources.uniformsBuffer,
                    },
                },
                {
                    binding: 2,
                    resource: resources.lutSampler,
                },
                {
                    binding: 3,
                    resource: resources.transmittanceLut.view,
                },
                {
                    binding: 4,
                    resource: resources.multiScatteringLut.view,
                },
                {
                    binding: 5,
                    resource: resources.skyViewLut.view,
                },
            ].filter(e => e !== undefined)
                .map((e, i) => {
                e.binding = i;
                return e;
            }),
        });
        return new ComputePass(this.pipeline, [bindGroup, ...(shadowBindGroups ?? []), ...(customUniformsBindGroups ?? [])], [Math.ceil(resources.skyViewLut.texture.width / 16.0), Math.ceil(resources.skyViewLut.texture.height / 16.0), 1]);
    }
}
class AerialPerspectiveLutPipeline {
    device;
    pipeline;
    bindGroupLayout;
    aerialPerspectiveLutFormat;
    aerialPerspectiveSliceCount;
    aerialPerspectiveDistancePerSlice;
    multiscatteringLutSize;
    constructor(device, pipeline, bindGroupLayout, aerialPerspectiveLutFormat, aerialPerspectiveSliceCount, aerialPerspectiveDistancePerSlice, multiscatteringLutSize) {
        this.device = device;
        this.pipeline = pipeline;
        this.bindGroupLayout = bindGroupLayout;
        this.aerialPerspectiveLutFormat = aerialPerspectiveLutFormat;
        this.aerialPerspectiveSliceCount = aerialPerspectiveSliceCount;
        this.aerialPerspectiveDistancePerSlice = aerialPerspectiveDistancePerSlice;
        this.multiscatteringLutSize = multiscatteringLutSize;
    }
    static makeBindGroupLayout(device, aerialPerspectiveLutFormat, customUniformsConfig) {
        return device.createBindGroupLayout({
            label: 'aerial perspective LUT pass',
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {
                        type: 'uniform',
                        hasDynamicOffset: false,
                        minBindingSize: ATMOSPHERE_BUFFER_SIZE,
                    },
                },
                customUniformsConfig ? undefined : {
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {
                        type: 'uniform',
                        hasDynamicOffset: false,
                        minBindingSize: UNIFORMS_BUFFER_SIZE,
                    },
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.COMPUTE,
                    sampler: {
                        type: 'filtering',
                    },
                },
                {
                    binding: 3,
                    visibility: GPUShaderStage.COMPUTE,
                    texture: {
                        sampleType: 'float',
                        viewDimension: '2d',
                        multisampled: false,
                    },
                },
                {
                    binding: 4,
                    visibility: GPUShaderStage.COMPUTE,
                    texture: {
                        sampleType: 'float',
                        viewDimension: '2d',
                        multisampled: false,
                    },
                },
                {
                    binding: 5,
                    visibility: GPUShaderStage.COMPUTE,
                    storageTexture: {
                        access: 'write-only',
                        format: aerialPerspectiveLutFormat,
                        viewDimension: '3d',
                    },
                },
            ].filter(e => e !== undefined)
                .map((e, i) => {
                e.binding = i;
                return e;
            }),
        });
    }
    static makePipelineDescriptor(device, bindGroupLayout, aerialPerspectiveLutFormat, aerialPerspectiveSliceCount, aerialPerspectiveDistancePerSlice, multiscatteringLutSize, fromKilometersScaleFactor, randomizeSampleOffsets, useMoon, shadowConfig, customUniformsConfig, miePhaseConfig) {
        return {
            label: 'aerial perspective LUT pass',
            layout: device.createPipelineLayout({
                label: 'aerial perspective LUT pass',
                bindGroupLayouts: [bindGroupLayout, ...(shadowConfig?.bindGroupLayouts ?? []), ...(customUniformsConfig?.bindGroupLayouts ?? [])],
            }),
            compute: {
                module: device.createShaderModule({
                    label: 'aerial perspective LUT',
                    code: makeAerialPerspectiveLutShaderCode(aerialPerspectiveLutFormat, shadowConfig?.wgslCode, customUniformsConfig?.wgslCode, miePhaseConfig?.constantDropletDiameter),
                }),
                entryPoint: 'render_aerial_perspective_lut',
                constants: {
                    AP_SLICE_COUNT: aerialPerspectiveSliceCount,
                    AP_DISTANCE_PER_SLICE: aerialPerspectiveDistancePerSlice,
                    MULTI_SCATTERING_LUT_RES_X: multiscatteringLutSize[0],
                    MULTI_SCATTERING_LUT_RES_Y: multiscatteringLutSize[1],
                    FROM_KM_SCALE: fromKilometersScaleFactor,
                    RANDOMIZE_SAMPLE_OFFSET: Number(randomizeSampleOffsets),
                    USE_MOON: Number(useMoon),
                    ...makeMiePhaseOverrides(miePhaseConfig),
                },
            },
        };
    }
    static async createAsync(device, aerialPerspectiveLutFormat, aerialPerspectiveSliceCount, aerialPerspectiveDistancePerSlice, multiscatteringLutSize, fromKilometersScaleFactor, randomizeSampleOffsets, useMoon, shadowConfig, customUniformsConfig, miePhaseConfig) {
        const bindGroupLayout = this.makeBindGroupLayout(device, aerialPerspectiveLutFormat, customUniformsConfig);
        const pipeline = await device.createComputePipelineAsync(this.makePipelineDescriptor(device, bindGroupLayout, aerialPerspectiveLutFormat, aerialPerspectiveSliceCount, aerialPerspectiveDistancePerSlice, multiscatteringLutSize, fromKilometersScaleFactor, randomizeSampleOffsets, useMoon, shadowConfig, customUniformsConfig, miePhaseConfig));
        return new AerialPerspectiveLutPipeline(device, pipeline, bindGroupLayout, aerialPerspectiveLutFormat, aerialPerspectiveSliceCount, aerialPerspectiveDistancePerSlice, multiscatteringLutSize);
    }
    static create(device, aerialPerspectiveLutFormat, aerialPerspectiveSliceCount, aerialPerspectiveDistancePerSlice, multiscatteringLutSize, fromKilometersScaleFactor, randomizeSampleOffsets, useMoon, shadowConfig, customUniformsConfig, miePhaseConfig) {
        const bindGroupLayout = this.makeBindGroupLayout(device, aerialPerspectiveLutFormat, customUniformsConfig);
        const pipeline = device.createComputePipeline(this.makePipelineDescriptor(device, bindGroupLayout, aerialPerspectiveLutFormat, aerialPerspectiveSliceCount, aerialPerspectiveDistancePerSlice, multiscatteringLutSize, fromKilometersScaleFactor, randomizeSampleOffsets, useMoon, shadowConfig, customUniformsConfig, miePhaseConfig));
        return new AerialPerspectiveLutPipeline(device, pipeline, bindGroupLayout, aerialPerspectiveLutFormat, aerialPerspectiveSliceCount, aerialPerspectiveDistancePerSlice, multiscatteringLutSize);
    }
    makeComputePass(resources, shadowBindGroups, customUniformsBindGroups) {
        if (this.device !== resources.device) {
            throw new Error(`[AerialPerspectiveLutPipeline::makeComputePass]: device mismatch`);
        }
        if (resources.atmosphereBuffer.size < ATMOSPHERE_BUFFER_SIZE) {
            throw new Error(`[AerialPerspectiveLutPipeline::makeComputePass]: buffer too small for atmosphere parameters (${resources.atmosphereBuffer.size} < ${ATMOSPHERE_BUFFER_SIZE})`);
        }
        if (resources.uniformsBuffer && resources.uniformsBuffer.size < UNIFORMS_BUFFER_SIZE) {
            throw new Error(`[AerialPerspectiveLutPipeline::makeComputePass]: buffer too small for config (${resources.atmosphereBuffer.size} < ${ATMOSPHERE_BUFFER_SIZE})`);
        }
        if (resources.multiScatteringLut.texture.width !== this.multiscatteringLutSize[0] || resources.multiScatteringLut.texture.height !== this.multiscatteringLutSize[1]) {
            throw new Error(`[AerialPerspectiveLutPipeline::makeComputePass]: wrong texture size for multiple scattering LUT. expected '${this.multiscatteringLutSize}', got ${[resources.multiScatteringLut.texture.width, resources.multiScatteringLut.texture.height]}`);
        }
        if (resources.aerialPerspectiveLut.texture.format !== this.aerialPerspectiveLutFormat) {
            throw new Error(`[AerialPerspectiveLutPipeline::makeComputePass]: wrong texture format for aerial perspective LUT. expected '${this.aerialPerspectiveLutFormat}', got ${resources.aerialPerspectiveLut.texture.format}`);
        }
        if (resources.aerialPerspectiveLut.texture.depthOrArrayLayers !== this.aerialPerspectiveSliceCount) {
            throw new Error(`[AerialPerspectiveLutPipeline::makeComputePass]: wrong texture depth for aerial perspective LUT. expected '${this.aerialPerspectiveSliceCount}', got ${resources.aerialPerspectiveLut.texture.depthOrArrayLayers}`);
        }
        const bindGroup = resources.device.createBindGroup({
            label: `aerial perspective LUT pass [${resources.label}]`,
            layout: this.bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: resources.atmosphereBuffer,
                    },
                },
                customUniformsBindGroups ? undefined : {
                    binding: 1,
                    resource: {
                        buffer: resources.uniformsBuffer,
                    },
                },
                {
                    binding: 2,
                    resource: resources.lutSampler,
                },
                {
                    binding: 3,
                    resource: resources.transmittanceLut.view,
                },
                {
                    binding: 4,
                    resource: resources.multiScatteringLut.view,
                },
                {
                    binding: 5,
                    resource: resources.aerialPerspectiveLut.view,
                },
            ].filter(e => e !== undefined)
                .map((e, i) => {
                e.binding = i;
                return e;
            }),
        });
        return new ComputePass(this.pipeline, [bindGroup, ...(shadowBindGroups ?? []), ...(customUniformsBindGroups ?? [])], [
            Math.ceil(resources.aerialPerspectiveLut.texture.width / 16.0),
            Math.ceil(resources.aerialPerspectiveLut.texture.height / 16.0),
            resources.aerialPerspectiveLut.texture.depthOrArrayLayers,
        ]);
    }
    get aerialPerspectiveInvDistancePerSlice() {
        return 1.0 / this.aerialPerspectiveDistancePerSlice;
    }
}
class SkyAtmospherePipelines {
    transmittanceLutPipeline;
    multiScatteringLutPipeline;
    skyViewLutPipeline;
    aerialPerspectiveLutPipeline;
    constructor(transmittanceLutPipeline, multiScatteringLutPipeline, skyViewLutPipeline, aerialPerspectiveLutPipeline) {
        this.transmittanceLutPipeline = transmittanceLutPipeline;
        this.multiScatteringLutPipeline = multiScatteringLutPipeline;
        this.skyViewLutPipeline = skyViewLutPipeline;
        this.aerialPerspectiveLutPipeline = aerialPerspectiveLutPipeline;
    }
    static getTransmittanceLutArgs(config) {
        return [
            config.lookUpTables?.transmittanceLut?.format ?? TRANSMITTANCE_LUT_FORMAT,
            config.lookUpTables?.transmittanceLut?.sampleCount ?? DEFAULT_TRANSMITTANCE_LUT_SAMPLE_COUNT,
        ];
    }
    static getMultiScatteringLutArgs(config) {
        return [
            config.lookUpTables?.multiScatteringLut?.format ?? MULTI_SCATTERING_LUT_FORMAT,
            config.lookUpTables?.multiScatteringLut?.sampleCount ?? DEFAULT_MULTI_SCATTERING_LUT_SAMPLE_COUNT,
        ];
    }
    static getSkyViewLutArgs(config) {
        return [
            config.lookUpTables?.skyViewLut?.format ?? SKY_VIEW_LUT_FORMAT,
            config.lookUpTables?.skyViewLut?.size ?? DEFAULT_SKY_VIEW_LUT_SIZE,
            config.lookUpTables?.multiScatteringLut?.size ?? [DEFAULT_MULTISCATTERING_LUT_SIZE, DEFAULT_MULTISCATTERING_LUT_SIZE],
            config.skyRenderer?.distanceToMaxSampleCount ?? 100.0,
            config.fromKilometersScale ?? 1.0,
            config.lights?.useMoon ?? false,
            (config.lookUpTables?.skyViewLut?.affectedByShadow ?? true) ? config.shadow : undefined,
            config.customUniformsSource,
            config.mieHgDrainePhase,
        ];
    }
    static getAerialPerspectiveLutArgs(config) {
        return [
            config.lookUpTables?.aerialPerspectiveLut?.format ?? AERIAL_PERSPECTIVE_LUT_FORMAT,
            (config.lookUpTables?.aerialPerspectiveLut?.size ?? DEFAULT_AERIAL_PERSPECTIVE_LUT_SIZE)[2],
            config.lookUpTables?.aerialPerspectiveLut?.distancePerSlice ?? 4.0,
            config.lookUpTables?.multiScatteringLut?.size ?? [DEFAULT_MULTISCATTERING_LUT_SIZE, DEFAULT_MULTISCATTERING_LUT_SIZE],
            config.fromKilometersScale ?? 1.0,
            config.lookUpTables?.aerialPerspectiveLut?.randomizeRayOffsets ?? false,
            config.lights?.useMoon ?? false,
            (config.lookUpTables?.aerialPerspectiveLut?.affectedByShadow ?? true) ? config.shadow : undefined,
            config.customUniformsSource,
            config.mieHgDrainePhase,
        ];
    }
    static async createAsync(device, config) {
        const transmittanceLutArgs = this.getTransmittanceLutArgs(config);
        const multiScatteringLutArgs = this.getMultiScatteringLutArgs(config);
        const skyViewLutArgs = this.getSkyViewLutArgs(config);
        const aerialPerspectiveLutArgs = this.getAerialPerspectiveLutArgs(config);
        const transmittanceLutPipeline = TransmittanceLutPipeline.createAsync(device, transmittanceLutArgs[0], transmittanceLutArgs[1]);
        const multiScatteringLutPipeline = MultiScatteringLutPipeline.createAsync(device, multiScatteringLutArgs[0], multiScatteringLutArgs[1]);
        const skyViewLutPipeline = SkyViewLutPipeline.createAsync(device, skyViewLutArgs[0], skyViewLutArgs[1], skyViewLutArgs[2], skyViewLutArgs[3], skyViewLutArgs[4], skyViewLutArgs[5], skyViewLutArgs[6], skyViewLutArgs[7], skyViewLutArgs[8]);
        const aerialPerspectiveLutPipeline = AerialPerspectiveLutPipeline.createAsync(device, aerialPerspectiveLutArgs[0], aerialPerspectiveLutArgs[1], aerialPerspectiveLutArgs[2], aerialPerspectiveLutArgs[3], aerialPerspectiveLutArgs[4], aerialPerspectiveLutArgs[5], aerialPerspectiveLutArgs[6], aerialPerspectiveLutArgs[7], aerialPerspectiveLutArgs[8], aerialPerspectiveLutArgs[9]);
        return new SkyAtmospherePipelines(await transmittanceLutPipeline, await multiScatteringLutPipeline, await skyViewLutPipeline, await aerialPerspectiveLutPipeline);
    }
    static create(device, config) {
        const transmittanceLutArgs = this.getTransmittanceLutArgs(config);
        const multiScatteringLutArgs = this.getMultiScatteringLutArgs(config);
        const skyViewLutArgs = this.getSkyViewLutArgs(config);
        const aerialPerspectiveLutArgs = this.getAerialPerspectiveLutArgs(config);
        const transmittanceLutPipeline = TransmittanceLutPipeline.create(device, transmittanceLutArgs[0], transmittanceLutArgs[1]);
        const multiScatteringLutPipeline = MultiScatteringLutPipeline.create(device, multiScatteringLutArgs[0], multiScatteringLutArgs[1]);
        const skyViewLutPipeline = SkyViewLutPipeline.create(device, skyViewLutArgs[0], skyViewLutArgs[1], skyViewLutArgs[2], skyViewLutArgs[3], skyViewLutArgs[4], skyViewLutArgs[5], skyViewLutArgs[6], skyViewLutArgs[7], skyViewLutArgs[8]);
        const aerialPerspectiveLutPipeline = AerialPerspectiveLutPipeline.create(device, aerialPerspectiveLutArgs[0], aerialPerspectiveLutArgs[1], aerialPerspectiveLutArgs[2], aerialPerspectiveLutArgs[3], aerialPerspectiveLutArgs[4], aerialPerspectiveLutArgs[5], aerialPerspectiveLutArgs[6], aerialPerspectiveLutArgs[7], aerialPerspectiveLutArgs[8], aerialPerspectiveLutArgs[9]);
        return new SkyAtmospherePipelines(transmittanceLutPipeline, multiScatteringLutPipeline, skyViewLutPipeline, aerialPerspectiveLutPipeline);
    }
}

/*
 * Copyright (c) 2024 Lukas Herzberger
 * SPDX-License-Identifier: MIT
 */
class SkyAtmosphereLutRenderer {
    resources;
    pipelines;
    skipDynamicLutRendering;
    usesCustomUniforms;
    transmittanceLutPass;
    multiScatteringLutPass;
    skyViewLutPass;
    aerialPerspectiveLutPass;
    constructor(resources, pipelines, skipDynamicLutRendering, usesCustomUniforms, transmittanceLutPass, multiScatteringLutPass, skyViewLutPass, aerialPerspectiveLutPass) {
        this.resources = resources;
        this.pipelines = pipelines;
        this.skipDynamicLutRendering = skipDynamicLutRendering;
        this.usesCustomUniforms = usesCustomUniforms;
        this.transmittanceLutPass = transmittanceLutPass;
        this.multiScatteringLutPass = multiScatteringLutPass;
        this.skyViewLutPass = skyViewLutPass;
        this.aerialPerspectiveLutPass = aerialPerspectiveLutPass;
    }
    /**
     * Creates a {@link SkyAtmosphereLutRenderer}.
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static create(device, config, existingPipelines, existingResources) {
        let skyAtmospherePipelines;
        if ((existingPipelines?.transmittanceLutPipeline.device || device) !== device) {
            skyAtmospherePipelines = SkyAtmospherePipelines.create(device, config);
        }
        else {
            skyAtmospherePipelines = existingPipelines || SkyAtmospherePipelines.create(device, config);
        }
        const defaultToPerPixelRayMarch = config.skyRenderer?.defaultToPerPixelRayMarch ?? false;
        const usesCustomUniforms = config.customUniformsSource !== undefined;
        const resources = existingResources || new SkyAtmosphereResources(device, config);
        const transmittanceLutPass = skyAtmospherePipelines.transmittanceLutPipeline.makeComputePass(resources);
        const multiScatteringLutPass = skyAtmospherePipelines.multiScatteringLutPipeline.makeComputePass(resources);
        const skyViewLutPass = skyAtmospherePipelines.skyViewLutPipeline.makeComputePass(resources, (config.lookUpTables?.skyViewLut?.affectedByShadow ?? true) ? config.shadow?.bindGroups : undefined, config.customUniformsSource?.bindGroups);
        const aerialPerspectiveLutPass = skyAtmospherePipelines.aerialPerspectiveLutPipeline.makeComputePass(resources, (config.lookUpTables?.aerialPerspectiveLut?.affectedByShadow ?? true) ? config.shadow?.bindGroups : undefined, config.customUniformsSource?.bindGroups);
        const lutRenderer = new SkyAtmosphereLutRenderer(resources, skyAtmospherePipelines, defaultToPerPixelRayMarch, usesCustomUniforms, transmittanceLutPass, multiScatteringLutPass, skyViewLutPass, aerialPerspectiveLutPass);
        if (config.initializeConstantLuts ?? true) {
            const commandEncoder = device.createCommandEncoder();
            const computePassEncoder = commandEncoder.beginComputePass();
            lutRenderer.renderConstantLuts(computePassEncoder);
            computePassEncoder.end();
            device.queue.submit([commandEncoder.finish()]);
        }
        return lutRenderer;
    }
    /**
     * Asynchronously creates a {@link SkyAtmosphereLutRenderer}.
     *
     * All pipelines used by this renderer are created asynchronously.
     *
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static async createAsync(device, config, existingPipelines, existingResources) {
        let skyAtmospherePipelines;
        if ((existingPipelines?.transmittanceLutPipeline.device || device) !== device) {
            skyAtmospherePipelines = await SkyAtmospherePipelines.createAsync(device, config);
        }
        else {
            skyAtmospherePipelines = existingPipelines || await SkyAtmospherePipelines.createAsync(device, config);
        }
        return this.create(device, config, skyAtmospherePipelines, existingResources);
    }
    /**
     * Updates the renderer's internal uniform buffer containing the {@link Atmosphere} parameters as well as its host-side copy of {@link Atmosphere} parameters.
     * @param atmosphere The new {@link Atmosphere} to override the current parameters.
     *
     * @see {@link SkyAtmosphereResources.updateAtmosphere}: Updates the host-side {@link Atmosphere} parameters as well as the corresponding uniform buffer.
     */
    updateAtmosphere(atmosphere) {
        this.resources.updateAtmosphere(atmosphere);
    }
    /**
     * Updates the renderer's internal uniform buffer containing the {@link Uniforms} as well as its host-side copy of {@link Uniforms}.
     * @param uniforms The new {@link Uniforms} to override the current parameters.
     *
     * If custom uniform buffers are used, this does nothing (see {@link CustomUniformsSourceConfig}).
     *
     * @see {@link SkyAtmosphereResources.updateUniforms}: Update the {@link Uniforms} uniform buffers.
     */
    updateUniforms(uniforms) {
        if (!this.usesCustomUniforms) {
            this.resources.updateUniforms(uniforms);
        }
    }
    /**
     * Renders the transmittance lookup table.
     *
     * To produce meaningful results, this requires the internal uniform buffer containing the {@link Atmosphere} parameters to hold valid data.
     * Call {@link updateAtmosphere} to ensure this is the case.
     *
     * Since the transmittance lookup table is not view or light souce dependent, this only needs to be called if the {@link Atmosphere} parameters change.
     *
     * @param passEncoder Used to encode rendering of the lookup table. The encoder is not `end()`ed by this function.
     *
     * @see {@link updateAtmosphere}: To write {@link Atmosphere} parameters to the internal uniform buffer, call this function.
     */
    renderTransmittanceLut(passEncoder) {
        this.transmittanceLutPass.encode(passEncoder);
    }
    /**
     * Renders the multiple scattering lookup table.
     *
     * To produce meaningful results, this requires the internal uniform buffer containing the {@link Atmosphere} parameters to hold valid data.
     * Call {@link updateAtmosphere} to ensure this is the case.
     *
     * Since the multiple scattering lookup table is not view or light souce dependent, this only needs to be called if the {@link Atmosphere} parameters change.
     *
     * @param passEncoder Used to encode rendering of the lookup table. The encoder is not `end()`ed by this function.
     *
     * @see {@link updateAtmosphere}: To write {@link Atmosphere} parameters to the internal uniform buffer, call this function.
     */
    renderMultiScatteringLut(passEncoder) {
        this.multiScatteringLutPass.encode(passEncoder);
    }
    /**
     * Renders the transmittance and multiple scattering lookup tables.
     *
     * To produce meaningful results, this requires the internal uniform buffer containing the {@link Atmosphere} parameters to hold valid data.
     * Use the {@link atmosphere} parameter to implicitly update the {@link Atmosphere} parameters or call {@link updateAtmosphere} to ensure this is the case.
     *
     * Since the transmittance and multiple scattering lookup tables are not view or light souce dependent, this only needs to be called if the {@link Atmosphere} parameters change.
     *
     * @param passEncoder Used to encode rendering of the lookup tables. The encoder is not `end()`ed by this function.
     * @param atmosphere If this is defined, {@link updateAtmosphere} is called before rendering the lookup tables.
     *
     * @see {@link updateAtmosphere}: Updates the {@link Atmosphere} parameters.
     * @see {@link renderTransmittanceLut}: Renders the transmittance lookup table.
     * @see {@link renderMultiScatteringLut}: Renders the multiple scattering lookup table.
     */
    renderConstantLuts(passEncoder, atmosphere) {
        if (atmosphere) {
            this.updateAtmosphere(atmosphere);
        }
        this.renderTransmittanceLut(passEncoder);
        this.renderMultiScatteringLut(passEncoder);
    }
    /**
     * Renders the sky view table.
     *
     * To produce meaningful results, this requires the transmittance and multiple scattering lookup tables, as well as the uniform buffers containing the {@link Atmosphere} and {@link Uniforms} parameters to hold valid data.
     * Call {@link renderConstantLuts} and {@link updateUniforms} to ensure this is the case.
     *
     * @param passEncoder Used to encode rendering of the lookup table. The encoder is not `end()`ed by this function.
     *
     * @see {@link renderConstantLuts}: To initialize the transmittance and multiple scattering lookup tables, as well as the internal uniform buffer storing the {@link Atmosphere} parameters, call this function.
     * @see {@link updateUniforms}: To write {@link Uniforms} to the internal uniform buffer, call this function.
     */
    renderSkyViewLut(passEncoder) {
        this.skyViewLutPass.encode(passEncoder);
    }
    /**
     * Renders the aerial perspective lookup table.
     *
     * To produce meaningful results, this requires the transmittance and multiple scattering lookup tables, as well as the uniform buffers containing the {@link Atmosphere} and {@link Uniforms} parameters to hold valid data.
     * Call {@link renderConstantLuts} and {@link updateUniforms} to ensure this is the case.
     *
     * If (a) user-defined shadow map(s) is used (see {@link SkyAtmosphereRendererConfig.shadow}), make sure to encode any updates of the shadow map(s) before encoding this pass.
     *
     * @param passEncoder Used to encode rendering of the lookup table. The encoder is not `end()`ed by this function.
     *
     * @see {@link renderConstantLuts}: To initialize the transmittance and multiple scattering lookup tables, as well as the internal uniform buffer storing the {@link Atmosphere} parameters, call this function.
     * @see {@link updateUniforms}: To write {@link Uniforms} to the internal uniform buffer, call this function.
     */
    renderAerialPerspectiveLut(passEncoder) {
        this.aerialPerspectiveLutPass.encode(passEncoder);
    }
    /**
     * Renders the sky view and aerial perspective lookup tables.
     *
     * To produce meaningful results, this requires the transmittance and multiple scattering lookup tables, as well as the uniform buffers containing the {@link Atmosphere} and {@link Uniforms} parameters to hold valid data.
     * Call {@link renderConstantLuts} and {@link updateUniforms} to ensure this is the case.
     *
     * If (a) user-defined shadow map(s) is used (see {@link SkyAtmosphereRendererConfig.shadow}), make sure to encode any updates of the shadow map(s) before encoding this pass.
     *
     * @param passEncoder Used to encode rendering of the lookup tables. The encoder is not `end()`ed by this function.
     * @param uniforms If this is defined, {@link updateUniforms} is called before rendering the lookup tables.
     *
     * @see {@link renderConstantLuts}: To initialize the transmittance and multiple scattering lookup tables, as well as the internal uniform buffer storing the {@link Atmosphere} parameters, call this function.
     * @see {@link updateUniforms}: Updates the internal {@link Uniforms} uniform buffer.
     * @see {@link renderSkyViewLut}: Renders the sky view lookup table.
     * @see {@link renderAerialPerspectiveLut}: Renders the aerial perspective lookup table.
     */
    renderDynamicLuts(passEncoder, uniforms) {
        if (uniforms) {
            this.updateUniforms(uniforms);
        }
        this.renderSkyViewLut(passEncoder);
        this.renderAerialPerspectiveLut(passEncoder);
    }
    /**
     * Renders the lookup tables required for rendering the sky / atmosphere.
     *
     * To initialize or update the transmittance and multiple scattering lookup tables, pass new {@link Atmosphere} paramters to this function or use the `forceConstantLutRendering` parameter.
     *
     * @param passEncoder A `GPUComputePassEncoder` to encode passes with. The encoder is not `end()`ed by this function.
     * @param uniforms {@link Uniforms} to use for this frame. If this is given, the internal uniform buffer will be updated using {@link updateUniforms}.
     * @param atmosphere {@link Atmosphere} parameters to use for this frame. If this is given, the internal uniform buffer storing the {@link Atmosphere} parameters will be updated and the transmittance and multiple scattering lookup tables will be rendered.
     * @param skipDynamicLutRendering If this is true, the sky view and aerial perspective lookup tables will not be rendered. Defaults to {@link skipDynamicLutRendering}.
     * @param forceConstantLutRendering If this is true, the transmittance and multiple scattering lookup tables will be rendered regardless of whether the `atmosphere` parameter is `undefined` or not.
     * @param forceSkyViewLutRendering If this is true, the sky view lookup table will be rendered, even if {@link skipDynamicLutRendering} is true. Defaults to false.
     *
     * @see {@link renderConstantLuts}: Renders the lookup tables that are constant for a given {@link Atmosphere}.
     * @see {@link updateUniforms}: Updates the internal {@link Uniforms} uniform buffer.
     * @see {@link renderDynamicLuts}: Renders the view-dependent lookup tables.
     * @see {@link renderSkyViewLut}: Renders the sky view lookup table.
     */
    renderLuts(passEncoder, uniforms, atmosphere, skipDynamicLutRendering, forceConstantLutRendering, forceSkyViewLutRendering) {
        if (atmosphere || (forceConstantLutRendering ?? false)) {
            this.renderConstantLuts(passEncoder, atmosphere);
        }
        if (skipDynamicLutRendering ?? false) {
            if (uniforms) {
                this.updateUniforms(uniforms);
            }
            if (forceSkyViewLutRendering ?? false) {
                this.renderSkyViewLut(passEncoder);
            }
        }
        else {
            this.renderDynamicLuts(passEncoder, uniforms);
        }
    }
}

/*
 * Copyright (c) 2024 Lukas Herzberger
 * SPDX-License-Identifier: MIT
 */
function makeSkyRendereringBaseLayoutEntries(config, resources, visibility) {
    return [
        {
            binding: 0,
            visibility,
            buffer: {
                type: 'uniform',
                hasDynamicOffset: false,
                minBindingSize: ATMOSPHERE_BUFFER_SIZE,
            },
        },
        config.customUniformsSource ? undefined : {
            binding: 1,
            visibility,
            buffer: {
                type: 'uniform',
                hasDynamicOffset: false,
                minBindingSize: UNIFORMS_BUFFER_SIZE,
            },
        },
        {
            binding: 2,
            visibility,
            sampler: {
                type: 'filtering',
            },
        },
        {
            binding: 3,
            visibility,
            texture: {
                sampleType: 'float',
                viewDimension: resources.transmittanceLut.texture.dimension,
                multisampled: false,
            },
        },
    ].filter(e => e !== undefined);
}
function makeWithLutsBindGroupLayout(device, config, externalEntries, resources, visibility) {
    const renderSkyBindGroupLayoutBaseEntries = makeSkyRendereringBaseLayoutEntries(config, resources, visibility);
    return device.createBindGroupLayout({
        label: `Render sky with luts bind group layout [${resources.label}]`,
        entries: [
            ...renderSkyBindGroupLayoutBaseEntries,
            {
                binding: 4,
                visibility,
                texture: {
                    sampleType: 'float',
                    viewDimension: resources.skyViewLut.texture.dimension,
                    multisampled: false,
                },
            },
            {
                binding: 5,
                visibility,
                texture: {
                    sampleType: 'float',
                    viewDimension: resources.aerialPerspectiveLut.texture.dimension,
                    multisampled: false,
                },
            },
            ...externalEntries,
        ].map((v, i) => {
            v.binding = i;
            return v;
        }),
    });
}
function makeRayMarchBindGroupLayout(device, config, externalEntries, resources, rayMarchDistantSky, visibility) {
    const renderSkyBindGroupLayoutBaseEntries = makeSkyRendereringBaseLayoutEntries(config, resources, visibility);
    return device.createBindGroupLayout({
        label: `Render sky raymarching bind group layout [${resources.label}]`,
        entries: [
            ...renderSkyBindGroupLayoutBaseEntries,
            {
                binding: 4,
                visibility,
                texture: {
                    sampleType: 'float',
                    viewDimension: resources.multiScatteringLut.texture.dimension,
                    multisampled: false,
                },
            },
            rayMarchDistantSky ? undefined : {
                binding: 5,
                visibility,
                texture: {
                    sampleType: 'float',
                    viewDimension: resources.skyViewLut.texture.dimension,
                    multisampled: false,
                },
            },
            ...externalEntries,
        ].filter(e => e !== undefined)
            .map((v, i) => {
            v.binding = i;
            return v;
        }),
    });
}
function makeSkyRenderingBaseEntries(resources, customUniforms) {
    return [
        {
            binding: 0,
            resource: {
                buffer: resources.atmosphereBuffer,
            },
        },
        customUniforms ? undefined : {
            binding: 1,
            resource: {
                buffer: resources.uniformsBuffer,
            },
        },
        {
            binding: 2,
            resource: resources.lutSampler,
        },
        {
            binding: 3,
            resource: resources.transmittanceLut.view,
        },
    ].filter(e => e !== undefined);
}
function makeWithLutsBindGroup(resources, layout, customUniforms, externalEntries) {
    return resources.device.createBindGroup({
        label: `Render sky with LUTs bind group [${resources.label}]`,
        layout: layout,
        entries: [
            ...makeSkyRenderingBaseEntries(resources, customUniforms),
            {
                binding: 4,
                resource: resources.skyViewLut.view,
            },
            {
                binding: 5,
                resource: resources.aerialPerspectiveLut.view,
            },
            ...externalEntries,
        ].map((v, i) => {
            v.binding = i;
            return v;
        }),
    });
}
function makeRayMarchBindGroup(resources, layout, customUniforms, externalEntries, rayMarchDistantSky) {
    return resources.device.createBindGroup({
        label: `Render sky raymarching bind group [${resources.label}]`,
        layout: layout,
        entries: [
            ...makeSkyRenderingBaseEntries(resources, customUniforms),
            {
                binding: 4,
                resource: resources.multiScatteringLut.view,
            },
            rayMarchDistantSky ? undefined : {
                binding: 5,
                resource: resources.skyViewLut.view,
            },
            ...externalEntries,
        ].filter(e => e !== undefined)
            .map((v, i) => {
            v.binding = i;
            return v;
        }),
    });
}
function makeWithLutsConstants(config, lutRenderer) {
    return {
        AP_SLICE_COUNT: lutRenderer.resources.aerialPerspectiveLut.texture.depthOrArrayLayers,
        AP_DISTANCE_PER_SLICE: lutRenderer.pipelines.aerialPerspectiveLutPipeline.aerialPerspectiveDistancePerSlice,
        AP_INV_DISTANCE_PER_SLICE: lutRenderer.pipelines.aerialPerspectiveLutPipeline.aerialPerspectiveInvDistancePerSlice,
        SKY_VIEW_LUT_RES_X: lutRenderer.resources.skyViewLut.texture.width,
        SKY_VIEW_LUT_RES_Y: lutRenderer.resources.skyViewLut.texture.height,
        IS_REVERSE_Z: Number(config.skyRenderer.depthBuffer.reverseZ ?? false),
        FROM_KM_SCALE: config.fromKilometersScale ?? 1.0,
        RENDER_SUN_DISK: Number(config.lights?.renderSunDisk ?? true),
        RENDER_MOON_DISK: Number(config.lights?.renderMoonDisk ?? (config.lights?.useMoon ?? false)),
        LIMB_DARKENING_ON_SUN: Number(config.lights?.applyLimbDarkeningOnSun ?? true),
        LIMB_DARKENING_ON_MOON: Number(config.lights?.applyLimbDarkeningOnMoon ?? false),
        USE_MOON: Number(config.lights?.useMoon ?? false),
    };
}
function makeRayMarchConstantsBase(config, lutRenderer, rayMarchDistantSky) {
    const constants = {
        INV_DISTANCE_TO_MAX_SAMPLE_COUNT: 1.0 / (config.skyRenderer.distanceToMaxSampleCount ?? 100.0),
        RANDOMIZE_SAMPLE_OFFSET: Number(config.skyRenderer.rayMarch?.randomizeRayOffsets ?? true),
        MULTI_SCATTERING_LUT_RES_X: lutRenderer.resources.multiScatteringLut.texture.width,
        MULTI_SCATTERING_LUT_RES_Y: lutRenderer.resources.multiScatteringLut.texture.height,
        IS_REVERSE_Z: Number(config.skyRenderer.depthBuffer.reverseZ ?? false),
        FROM_KM_SCALE: config.fromKilometersScale ?? 1.0,
        RENDER_SUN_DISK: Number(config.lights?.renderSunDisk ?? true),
        RENDER_MOON_DISK: Number(config.lights?.renderMoonDisk ?? (config.lights?.useMoon ?? false)),
        LIMB_DARKENING_ON_SUN: Number(config.lights?.applyLimbDarkeningOnSun ?? true),
        LIMB_DARKENING_ON_MOON: Number(config.lights?.applyLimbDarkeningOnMoon ?? false),
        USE_MOON: Number(config.lights?.useMoon ?? false),
        ...makeMiePhaseOverrides(config.mieHgDrainePhase),
    };
    if (!rayMarchDistantSky) {
        constants['SKY_VIEW_LUT_RES_X'] = lutRenderer.resources.skyViewLut.texture.width;
        constants['SKY_VIEW_LUT_RES_Y'] = lutRenderer.resources.skyViewLut.texture.height;
    }
    return constants;
}

/*
 * Copyright (c) 2024 Lukas Herzberger
 * SPDX-License-Identifier: MIT
 */
class SkyComputeRenderer {
    lutRenderer;
    bindGroupLayout;
    pass;
    doesRayMarchDistantSky;
    constructor(lutRenderer, bindGroupLayout, pipeline, config, isRayMarchPass) {
        this.lutRenderer = lutRenderer;
        this.bindGroupLayout = bindGroupLayout;
        this.doesRayMarchDistantSky = config.skyRenderer.rayMarch?.rayMarchDistantSky ?? true;
        const bindGroup = this.makeBindGroup({
            depthBuffer: config.skyRenderer.depthBuffer.view ?? config.skyRenderer.depthBuffer.texture,
            backBuffer: config.skyRenderer.backBuffer.view ?? config.skyRenderer.backBuffer.texture,
            renderTarget: config.skyRenderer.renderTarget.view ?? config.skyRenderer.renderTarget.texture,
        });
        const dispatchDimensions = [
            Math.ceil(config.skyRenderer.renderTarget.texture.width / 16.0),
            Math.ceil(config.skyRenderer.renderTarget.texture.height / 16.0),
            1,
        ];
        this.pass = new ComputePass(pipeline, [
            bindGroup,
            ...(isRayMarchPass ? config.shadow?.bindGroups ?? [] : []),
            ...(config.customUniformsSource?.bindGroups ?? []),
        ], dispatchDimensions);
    }
    static makeExternalBindGroupLayoutEntries(config) {
        return [
            {
                binding: 5,
                visibility: GPUShaderStage.COMPUTE,
                texture: {
                    sampleType: 'unfilterable-float',
                    viewDimension: config.skyRenderer.depthBuffer.texture.dimension,
                    multisampled: false,
                },
            },
            {
                binding: 6,
                visibility: GPUShaderStage.COMPUTE,
                texture: {
                    sampleType: 'unfilterable-float',
                    viewDimension: config.skyRenderer.backBuffer.texture.dimension,
                    multisampled: false,
                },
            },
            {
                binding: 7,
                visibility: GPUShaderStage.COMPUTE,
                storageTexture: {
                    access: 'write-only',
                    format: config.skyRenderer.renderTarget.texture.format,
                    viewDimension: config.skyRenderer.renderTarget.texture.dimension,
                },
            },
        ];
    }
    makeExternalBindGroupEntries(config) {
        return [
            {
                binding: 5,
                resource: config.depthBuffer instanceof GPUTextureView ? config.depthBuffer : config.depthBuffer.createView(config.depthBuffer.format.includes('depth') ? {
                    aspect: 'depth-only',
                } : {}),
            },
            {
                binding: 6,
                resource: config.backBuffer instanceof GPUTextureView ? config.backBuffer : config.backBuffer.createView(),
            },
            {
                binding: 7,
                resource: config.renderTarget instanceof GPUTextureView ? config.renderTarget : config.renderTarget.createView(),
            },
        ];
    }
    /**
     * Replaces potentially screen-size dependent external resources (back buffer, depth buffer, and render target) in the internal bind groups.
     *
     * @param config Configuration of external resources.
     */
    onResize(config) {
        let size = config.size ?? [-1, -1];
        if (size[0] < 0) {
            if (config.backBuffer instanceof GPUTexture) {
                size = [config.backBuffer.width, config.backBuffer.height];
            }
            if (config.depthBuffer instanceof GPUTexture) {
                size = [config.depthBuffer.width, config.depthBuffer.height];
            }
            if (config.renderTarget instanceof GPUTexture) {
                size = [config.renderTarget.width, config.renderTarget.height];
            }
        }
        if (size[0] < 0 || size[1] < 0) {
            throw new Error(`[SkyAtmosphereComputeRenderer::onResize]: could not determine new size from config`);
        }
        this.pass.replaceBindGroup(0, this.makeBindGroup(config));
        this.pass.replaceDispatchDimensions([
            Math.ceil(size[0] / 16.0),
            Math.ceil(size[1] / 16.0),
            1,
        ]);
    }
    /**
     * Renders the sky / atmosphere.
     *
     * @param passEncoder A `GPUComputePassEncoder` to encode the pass with. Can be the same encoder used to initialize lookup tables required. The encoder is not `end()`ed by this function.
     */
    renderSky(passEncoder) {
        this.pass.encode(passEncoder);
    }
    updateAtmosphere(atmosphere) {
        this.lutRenderer.updateAtmosphere(atmosphere);
    }
    updateUniforms(uniforms) {
        this.lutRenderer.updateUniforms(uniforms);
    }
    renderTransmittanceLut(passEncoder) {
        this.lutRenderer.renderTransmittanceLut(passEncoder);
    }
    renderMultiScatteringLut(passEncoder) {
        this.lutRenderer.renderMultiScatteringLut(passEncoder);
    }
    renderConstantLuts(passEncoder, atmosphere) {
        this.lutRenderer.renderConstantLuts(passEncoder, atmosphere);
    }
    renderSkyViewLut(passEncoder) {
        this.lutRenderer.renderSkyViewLut(passEncoder);
    }
    renderAerialPerspectiveLut(passEncoder) {
        this.lutRenderer.renderAerialPerspectiveLut(passEncoder);
    }
    renderDynamicLuts(passEncoder, uniforms) {
        this.lutRenderer.renderDynamicLuts(passEncoder, uniforms);
    }
    renderLuts(passEncoder, uniforms, atmosphere, useFullResolutionRayMarch, forceConstantLutRendering, forceSkyViewLutRendering) {
        this.lutRenderer.renderLuts(passEncoder, uniforms, atmosphere, useFullResolutionRayMarch, forceConstantLutRendering, forceSkyViewLutRendering);
    }
    get resources() {
        return this.lutRenderer.resources;
    }
}
/**
 * A sky / atmosphere renderer that renders the sky based on lookup tables.
 * It uses `GPUComputePipeline`s to render the sky / atmosphere.
 */
class SkyWithLutsComputeRenderer extends SkyComputeRenderer {
    constructor(lutRenderer, bindGroupLayout, pipeline, config) {
        super(lutRenderer, bindGroupLayout, pipeline, config, false);
    }
    static makeBindGroupLayout(device, config, resources) {
        return makeWithLutsBindGroupLayout(device, config, this.makeExternalBindGroupLayoutEntries(config), resources, GPUShaderStage.COMPUTE);
    }
    static makeWithLutsPiplelineDescriptor(device, config, lutRenderer, renderSkyWithLutsBindGroupLayout) {
        return {
            label: `Render sky with LUTs pipeline [${lutRenderer.resources.label}]`,
            layout: device.createPipelineLayout({
                label: `Render sky with LUTs pipeline layout [${lutRenderer.resources.label}]`,
                bindGroupLayouts: [
                    renderSkyWithLutsBindGroupLayout,
                    ...(config.customUniformsSource?.bindGroupLayouts ?? []),
                ],
            }),
            compute: {
                module: device.createShaderModule({
                    code: makeRenderSkyWithLutsShaderCode(config.skyRenderer.renderTarget.texture.format, config.customUniformsSource?.wgslCode),
                }),
                entryPoint: 'render_sky_atmosphere',
                constants: makeWithLutsConstants(config, lutRenderer),
            },
        };
    }
    /**
     * Asynchronously creates a {@link SkyAtmosphereComputeRenderer}.
     *
     * All pipelines used by this renderer are created asynchronously.
     *
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingLutRenderer If this is defined, no new internal {@link SkyAtmosphereLutRenderer} will be created. Instead, the existing one is used.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static async createAsync(device, config, existingLutRenderer, existingPipelines, existingResources) {
        const lutRenderer = existingLutRenderer ?? await SkyAtmosphereLutRenderer.createAsync(device, config, existingPipelines, existingResources);
        const bindGroupLayout = this.makeBindGroupLayout(device, config, lutRenderer.resources);
        const pipeline = await device.createComputePipelineAsync(this.makeWithLutsPiplelineDescriptor(device, config, lutRenderer, bindGroupLayout));
        return new SkyWithLutsComputeRenderer(lutRenderer, bindGroupLayout, pipeline, config);
    }
    /**
     * Creates a {@link SkyAtmosphereComputeRenderer}.
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingLutRenderer If this is defined, no new internal {@link SkyAtmosphereLutRenderer} will be created. Instead, the existing one is used.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static create(device, config, existingLutRenderer, existingPipelines, existingResources) {
        const lutRenderer = existingLutRenderer ?? SkyAtmosphereLutRenderer.create(device, config, existingPipelines, existingResources);
        const bindGroupLayout = this.makeBindGroupLayout(device, config, lutRenderer.resources);
        const pipeline = device.createComputePipeline(this.makeWithLutsPiplelineDescriptor(device, config, lutRenderer, bindGroupLayout));
        return new SkyWithLutsComputeRenderer(lutRenderer, bindGroupLayout, pipeline, config);
    }
    makeBindGroup(config) {
        return makeWithLutsBindGroup(this.lutRenderer.resources, this.bindGroupLayout, this.lutRenderer.usesCustomUniforms, this.makeExternalBindGroupEntries(config));
    }
    renderLutsAndSky(passEncoder, uniforms, atmosphere, forceConstantLutRendering) {
        this.lutRenderer.renderLuts(passEncoder, uniforms, atmosphere, false, forceConstantLutRendering, false);
        this.renderSky(passEncoder);
    }
}
/**
 * A sky / atmosphere renderer that renders the sky using full-resolution ray marching.
 * It uses `GPUComputePipeline`s to render the sky / atmosphere.
 */
class SkyRayMarchComputeRenderer extends SkyComputeRenderer {
    constructor(lutRenderer, bindGroupLayout, pipeline, config) {
        super(lutRenderer, bindGroupLayout, pipeline, config, true);
    }
    static makeBindGroupLayout(device, config, resources, rayMarchDistantSky) {
        return makeRayMarchBindGroupLayout(device, config, this.makeExternalBindGroupLayoutEntries(config), resources, rayMarchDistantSky, GPUShaderStage.COMPUTE);
    }
    static makeRayMarchPipelineDescriptor(device, config, lutRenderer, renderSkyRaymarchingBindGroupLayout, rayMarchDistantSky) {
        const constants = {
            ...makeRayMarchConstantsBase(config, lutRenderer, rayMarchDistantSky),
            USE_COLORED_TRANSMISSION: Number(config.skyRenderer.rayMarch?.useColoredTransmittance ?? true),
        };
        const module = device.createShaderModule({
            code: (rayMarchDistantSky ? makeRenderSkyRaymarchingShaderCode : makeRenderSkyLutAndRaymarchingShaderCode)(config.skyRenderer.renderTarget.texture.format, config.shadow?.wgslCode, config.customUniformsSource?.wgslCode, config.mieHgDrainePhase?.constantDropletDiameter),
        });
        return {
            label: `Render sky raymarching pipeline [${lutRenderer.resources.label}]`,
            layout: device.createPipelineLayout({
                label: 'Render sky raymarching pipeline layout',
                bindGroupLayouts: [
                    renderSkyRaymarchingBindGroupLayout,
                    ...(config.shadow?.bindGroupLayouts ?? []),
                    ...(config.customUniformsSource?.bindGroupLayouts ?? []),
                ],
            }),
            compute: {
                module,
                entryPoint: 'render_sky_atmosphere',
                constants,
            },
        };
    }
    /**
     * Asynchronously creates a {@link SkyAtmosphereComputeRenderer}.
     *
     * All pipelines used by this renderer are created asynchronously.
     *
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingLutRenderer If this is defined, no new internal {@link SkyAtmosphereLutRenderer} will be created. Instead, the existing one is used.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static async createAsync(device, config, existingLutRenderer, existingPipelines, existingResources) {
        const rayMarchDistantSky = config.skyRenderer.rayMarch?.rayMarchDistantSky ?? true;
        const lutRenderer = existingLutRenderer ?? await SkyAtmosphereLutRenderer.createAsync(device, config, existingPipelines, existingResources);
        const bindGroupLayout = this.makeBindGroupLayout(device, config, lutRenderer.resources, rayMarchDistantSky);
        const pipelines = await device.createComputePipelineAsync(this.makeRayMarchPipelineDescriptor(device, config, lutRenderer, bindGroupLayout, rayMarchDistantSky));
        return new SkyRayMarchComputeRenderer(lutRenderer, bindGroupLayout, pipelines, config);
    }
    /**
     * Creates a {@link SkyAtmosphereComputeRenderer}.
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingLutRenderer If this is defined, no new internal {@link SkyAtmosphereLutRenderer} will be created. Instead, the existing one is used.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static create(device, config, existingLutRenderer, existingPipelines, existingResources) {
        const rayMarchDistantSky = config.skyRenderer.rayMarch?.rayMarchDistantSky ?? true;
        const lutRenderer = existingLutRenderer ?? SkyAtmosphereLutRenderer.create(device, config, existingPipelines, existingResources);
        const bindGroupLayout = this.makeBindGroupLayout(device, config, lutRenderer.resources, rayMarchDistantSky);
        const pipelines = device.createComputePipeline(this.makeRayMarchPipelineDescriptor(device, config, lutRenderer, bindGroupLayout, rayMarchDistantSky));
        return new SkyRayMarchComputeRenderer(lutRenderer, bindGroupLayout, pipelines, config);
    }
    makeBindGroup(config) {
        return makeRayMarchBindGroup(this.lutRenderer.resources, this.bindGroupLayout, this.lutRenderer.usesCustomUniforms, this.makeExternalBindGroupEntries(config), this.rayMarchDistantSky);
    }
    renderLutsAndSky(passEncoder, uniforms, atmosphere, forceConstantLutRendering) {
        this.lutRenderer.renderLuts(passEncoder, uniforms, atmosphere, true, forceConstantLutRendering, !this.rayMarchDistantSky);
        this.renderSky(passEncoder);
    }
    get rayMarchDistantSky() {
        return this.doesRayMarchDistantSky;
    }
}
/**
 * A {@link SkyAtmosphereLutRenderer} that uses `GPUComputePipeline`s to render the sky / atmosphere.
 */
class SkyAtmosphereComputeRenderer {
    lutRenderer;
    withLutsRenderer;
    rayMarchRenderer;
    defaultToFullResolutionRayMarch;
    constructor(lutRenderer, withLutsRenderer, rayMarchRenderer, defaultToFullResolutionRayMarch) {
        this.lutRenderer = lutRenderer;
        this.withLutsRenderer = withLutsRenderer;
        this.rayMarchRenderer = rayMarchRenderer;
        this.defaultToFullResolutionRayMarch = defaultToFullResolutionRayMarch;
    }
    /**
     * Asynchronously creates a {@link SkyAtmosphereComputeRenderer}.
     *
     * All pipelines used by this renderer are created asynchronously.
     *
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingLutRenderer If this is defined, no new internal {@link SkyAtmosphereLutRenderer} will be created. Instead, the existing one is used.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static async createAsync(device, config, existingLutRenderer, existingPipelines, existingResources) {
        const lutRenderer = existingLutRenderer ?? await SkyAtmosphereLutRenderer.createAsync(device, config, existingPipelines, existingResources);
        const [withLutsRenderer, rayMarchRenderer] = await Promise.all([SkyWithLutsComputeRenderer.createAsync(device, config, lutRenderer), SkyRayMarchComputeRenderer.createAsync(device, config, lutRenderer)]);
        return new SkyAtmosphereComputeRenderer(lutRenderer, withLutsRenderer, rayMarchRenderer, config.skyRenderer.defaultToPerPixelRayMarch ?? false);
    }
    /**
     * Creates a {@link SkyAtmosphereComputeRenderer}.
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingLutRenderer If this is defined, no new internal {@link SkyAtmosphereLutRenderer} will be created. Instead, the existing one is used.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static create(device, config, existingLutRenderer, existingPipelines, existingResources) {
        const lutRenderer = existingLutRenderer ?? SkyAtmosphereLutRenderer.create(device, config, existingPipelines, existingResources);
        return new SkyAtmosphereComputeRenderer(lutRenderer, SkyWithLutsComputeRenderer.create(device, config, lutRenderer), SkyRayMarchComputeRenderer.create(device, config, lutRenderer), config.skyRenderer.defaultToPerPixelRayMarch ?? false);
    }
    /**
     * Replaces potentially screen-size dependent external resources (back buffer, depth buffer, and render target) in the internal bind groups.
     *
     * @param config Configuration of external resources.
     */
    onResize(config) {
        this.withLutsRenderer.onResize(config);
        this.rayMarchRenderer.onResize(config);
    }
    /**
     * Renders the sky / atmosphere using precomputed lookup tables.
     *
     * Requires the sky view and aerial perspective lookup tables to be initialized.
     * To initialize these lookup tables, call {@link renderDynamicLuts}.
     *
     * @param passEncoder A `GPUComputePassEncoder` to encode the pass with. Can be the same encoder used to initialize the sky view and aerial perspective lookup tables. The encoder is not `end()`ed by this function.
     *
     * @see {@link renderDynamicLuts}: To initialize the lookup tables required, call this function.
     */
    renderSkyWithLuts(passEncoder) {
        this.withLutsRenderer.renderSky(passEncoder);
    }
    /**
     * Renders the sky / atmosphere using full-resolution ray marching.
     *
     * Requires the transmittance and multiple scattering lookup tables to be initialized.
     * Either initialize these lookup tables in the constructor using {@link SkyAtmosphereRendererConfig.initializeConstantLuts}, or call {@link renderConstantLuts}.
     *
     * @param passEncoder A `GPUComputePassEncoder` to encode the pass with. Can be the same encoder used to initialize the transmittance and multiple scattering lookup tables. The encoder is not `end()`ed by this function.
     *
     * @see {@link renderConstantLuts}: To initialize the lookup tables required, call this function.
     */
    renderSkyRaymarching(passEncoder) {
        this.rayMarchRenderer.renderSky(passEncoder);
    }
    /**
     * Renders the sky / atmosphere using either lookup tables or full-resolution ray marching, as well as all look up tables required by the respective approach.
     *
     * @param passEncoder A `GPUComputePassEncoder` to encode the sky / atmosphere rendering pass with. The encoder is not `end()`ed by this function.
     * @param useFullResolutionRayMarch If this is true, full-resolution ray marching will be used to render the sky / atmosphere. Defaults to {@link defaultToFullResolutionRayMarch}.
     *
     * @see {@link renderSkyWithLuts}: Renders the sky with lookup tables.
     * @see {@link renderSkyRaymarching}: Renders the sky with full-resolution ray marching.
     */
    renderSky(passEncoder, useFullResolutionRayMarch) {
        if (useFullResolutionRayMarch ?? this.defaultToFullResolutionRayMarch) {
            this.renderSkyRaymarching(passEncoder);
        }
        else {
            this.renderSkyWithLuts(passEncoder);
        }
    }
    /**
     * Renders the sky / atmosphere using either lookup tables or full-resolution ray marching, as well as all look up tables required by the respective approach.
     *
     * To initialize or update the transmittance and multiple scattering lookup tables, pass new {@link Atmosphere} paramters to this function or use the `forceConstantLutRendering` parameter.
     *
     * @param passEncoder A `GPUComputePassEncoder` to encode passes with. The encoder is not `end()`ed by this function.
     * @param uniforms {@link Uniforms} to use for this frame. If this is given, the internal uniform buffer will be updated using {@link updateUniforms}.
     * @param atmosphere {@link Atmosphere} parameters to use for this frame. If this is given, the internal uniform buffer storing the {@link Atmosphere} parameters will be updated and the transmittance and multiple scattering lookup tables will be rendered.
     * @param useFullResolutionRayMarch If this is true, full-resolution ray marching will be used to render the sky / atmosphere. In that case, the sky view and aerial perspective lookup tables will not be rendered. Defaults to {@link defaultToFullResolutionRayMarch}.
     * @param forceConstantLutRendering If this is true, the transmittance and multiple scattering lookup tables will be rendered regardless of whether the `atmosphere` parameter is `undefined` or not.
     *
     * @see {@link renderLuts}: Renders the lookup tables required for rendering the sky / atmosphere.
     * @see {@link renderSky}: Renders the sky / atmosphere using either low-resolution lookup tables or full-resolution ray marching.
     */
    renderLutsAndSky(passEncoder, uniforms, atmosphere, useFullResolutionRayMarch, forceConstantLutRendering) {
        const useRayMarch = useFullResolutionRayMarch ?? this.defaultToFullResolutionRayMarch;
        this.renderLuts(passEncoder, uniforms, atmosphere, useRayMarch, forceConstantLutRendering, !this.rayMarchRenderer.rayMarchDistantSky);
        this.renderSky(passEncoder, useRayMarch);
    }
    updateAtmosphere(atmosphere) {
        this.lutRenderer.updateAtmosphere(atmosphere);
    }
    updateUniforms(uniforms) {
        this.lutRenderer.updateUniforms(uniforms);
    }
    renderTransmittanceLut(passEncoder) {
        this.lutRenderer.renderTransmittanceLut(passEncoder);
    }
    renderMultiScatteringLut(passEncoder) {
        this.lutRenderer.renderMultiScatteringLut(passEncoder);
    }
    renderConstantLuts(passEncoder, atmosphere) {
        this.lutRenderer.renderConstantLuts(passEncoder, atmosphere);
    }
    renderSkyViewLut(passEncoder) {
        this.lutRenderer.renderSkyViewLut(passEncoder);
    }
    renderAerialPerspectiveLut(passEncoder) {
        this.lutRenderer.renderAerialPerspectiveLut(passEncoder);
    }
    renderDynamicLuts(passEncoder, uniforms) {
        this.lutRenderer.renderDynamicLuts(passEncoder, uniforms);
    }
    renderLuts(passEncoder, uniforms, atmosphere, useFullResolutionRayMarch, forceConstantLutRendering, forceSkyViewLutRendering) {
        this.lutRenderer.renderLuts(passEncoder, uniforms, atmosphere, useFullResolutionRayMarch, forceConstantLutRendering, forceSkyViewLutRendering);
    }
    get resources() {
        return this.lutRenderer.resources;
    }
}

/*
 * Copyright (c) 2024 Lukas Herzberger
 * SPDX-License-Identifier: MIT
 */
class SkyRasterRenderer {
    targetFormats;
    lutRenderer;
    bindGroupLayout;
    pass;
    bundle;
    doesRayMarchDistantSky;
    constructor(targetFormats, lutRenderer, bindGroupLayout, pipeline, config, isRayMarchPass) {
        this.targetFormats = targetFormats;
        this.lutRenderer = lutRenderer;
        this.bindGroupLayout = bindGroupLayout;
        this.doesRayMarchDistantSky = config.skyRenderer.rayMarch?.rayMarchDistantSky ?? true;
        const bindGroup = this.makeBindGroup(config.skyRenderer.depthBuffer.view ?? config.skyRenderer.depthBuffer.texture);
        this.pass = new RenderPass(pipeline, [
            bindGroup,
            ...(isRayMarchPass ? config.shadow?.bindGroups ?? [] : []),
            ...(config.customUniformsSource?.bindGroups ?? []),
        ]);
        if (config.skyRenderer.recordInternalRenderBundles ?? true) {
            this.bundle = this.recordBundle();
        }
    }
    static makeBlendStates() {
        return {
            single: {
                color: {
                    operation: 'add',
                    srcFactor: 'one',
                    dstFactor: 'one-minus-src-alpha',
                },
                alpha: {
                    operation: 'add',
                    srcFactor: 'zero',
                    dstFactor: 'one',
                },
            },
            dual: {
                color: {
                    operation: 'add',
                    srcFactor: 'one',
                    dstFactor: 'src1',
                },
                alpha: {
                    operation: 'add',
                    srcFactor: 'zero',
                    dstFactor: 'one',
                },
            },
        };
    }
    static makeExternalBindGroupLayoutEntries(config) {
        return [
            {
                binding: 6,
                visibility: GPUShaderStage.FRAGMENT,
                texture: {
                    sampleType: 'unfilterable-float',
                    viewDimension: config.skyRenderer.depthBuffer.texture.dimension,
                    multisampled: false,
                },
            },
        ];
    }
    makeExternalBindGroupEntries(depthBuffer) {
        return [
            {
                binding: 6,
                resource: depthBuffer instanceof GPUTextureView ? depthBuffer : depthBuffer.createView(depthBuffer.format.includes('depth') ? {
                    aspect: 'depth-only',
                } : {}),
            },
        ];
    }
    /**
     * Replaces potentially screen-size dependent external resources (depth buffer) in the internal bind groups.
     *
     * @param depthBuffer The depth buffer to limit the ray marching distance when rendering the sky / atmosphere.
     *                    If this is a textue, a texture view will be created.
     *                    If this is a texture view, it must be allowed to be bound as a `texture<f32>`.
     *                    I.e., if the texture has a depth-stencil format, the texture view must be a `"depth-only"` view.
     */
    onResize(depthBuffer) {
        this.pass.replaceBindGroup(0, this.makeBindGroup(depthBuffer));
        if (this.bundle) {
            this.bundle = this.recordBundle();
        }
    }
    /**
     * Renders the sky / atmosphere.
     *
     * @param passEncoder A `GPURenderPassEncoder` or `GPURenderBundleEncoder` to encode the pass with. The encoder is not `end()`ed by this function.
     */
    renderSky(passEncoder) {
        if (passEncoder instanceof GPURenderPassEncoder && this.bundle) {
            passEncoder.executeBundles([this.bundle]);
        }
        else {
            this.pass.encode(passEncoder);
        }
    }
    recordBundle() {
        const encoder = this.lutRenderer.resources.device.createRenderBundleEncoder({
            label: 'Render sky bundle',
            colorFormats: this.targetFormats,
        });
        this.renderSky(encoder);
        return encoder.finish();
    }
    updateAtmosphere(atmosphere) {
        this.lutRenderer.updateAtmosphere(atmosphere);
    }
    updateUniforms(uniforms) {
        this.lutRenderer.updateUniforms(uniforms);
    }
    renderTransmittanceLut(passEncoder) {
        this.lutRenderer.renderTransmittanceLut(passEncoder);
    }
    renderMultiScatteringLut(passEncoder) {
        this.lutRenderer.renderMultiScatteringLut(passEncoder);
    }
    renderConstantLuts(passEncoder, atmosphere) {
        this.lutRenderer.renderConstantLuts(passEncoder, atmosphere);
    }
    renderSkyViewLut(passEncoder) {
        this.lutRenderer.renderSkyViewLut(passEncoder);
    }
    renderAerialPerspectiveLut(passEncoder) {
        this.lutRenderer.renderAerialPerspectiveLut(passEncoder);
    }
    renderDynamicLuts(passEncoder, uniforms) {
        this.lutRenderer.renderDynamicLuts(passEncoder, uniforms);
    }
    renderLuts(passEncoder, uniforms, atmosphere, skipDynamicLutRendering, forceConstantLutRendering, forceSkyViewLutRendering) {
        this.lutRenderer.renderLuts(passEncoder, uniforms, atmosphere, skipDynamicLutRendering, forceConstantLutRendering, forceSkyViewLutRendering);
    }
    get resources() {
        return this.lutRenderer.resources;
    }
}
/**
 * A sky / atmosphere renderer that renders the sky based on lookup tables.
 * It uses `GPURenderPipeline`s to render the sky / atmosphere.
 */
class SkyWithLutsRasterRenderer extends SkyRasterRenderer {
    targetFormats;
    lutRenderer;
    bindGroupLayout;
    constructor(targetFormats, lutRenderer, bindGroupLayout, pipeline, config) {
        super(targetFormats, lutRenderer, bindGroupLayout, pipeline, config, false);
        this.targetFormats = targetFormats;
        this.lutRenderer = lutRenderer;
        this.bindGroupLayout = bindGroupLayout;
    }
    static makeBindGroupLayout(device, config, resources) {
        return makeWithLutsBindGroupLayout(device, config, this.makeExternalBindGroupLayoutEntries(config), resources, GPUShaderStage.FRAGMENT);
    }
    static makePipelineDescriptor(device, config, lutRenderer, bindGroupLayout, blendState, dualBlendState, useDualSourceBlending) {
        const writeTransmissionOnlyOnPerPixelRayMarch = config.skyRenderer.writeTransmissionOnlyOnPerPixelRayMarch ?? true;
        const useTwoTargets = config.skyRenderer.transmissionFormat && !useDualSourceBlending && !writeTransmissionOnlyOnPerPixelRayMarch;
        const targets = [
            {
                format: config.skyRenderer.renderTargetFormat,
                writeMask: GPUColorWrite.ALL,
            },
        ];
        if (useTwoTargets) {
            targets.push({ format: config.skyRenderer.transmissionFormat, });
        }
        else {
            targets[0].blend = useDualSourceBlending && !writeTransmissionOnlyOnPerPixelRayMarch ? dualBlendState : blendState;
        }
        let code = makeRenderSkyWithLutsShaderCode('rgba16float', config.customUniformsSource?.wgslCode);
        if (useDualSourceBlending && !writeTransmissionOnlyOnPerPixelRayMarch) {
            code = `enable dual_source_blending;\n${code}`;
            code = code.replace('@location(0)', '@location(0) @blend_src(0)');
            code = code.replace('@location(1)', '@location(0) @blend_src(1)');
        }
        else if (targets.length !== 2) {
            code = code.replace('@location(1) transmittance: vec4<f32>,', '');
            code = code.replace('RenderSkyFragment(vec4<f32>(result.rgb, 1.0), vec4<f32>(vec3<f32>(result.a), 1.0))', 'RenderSkyFragment(result)');
        }
        const module = device.createShaderModule({
            label: 'Render sky with LUTs',
            code,
        });
        return [
            {
                label: `Render sky with LUTs pipeline [${lutRenderer.resources.label}]`,
                layout: device.createPipelineLayout({
                    label: 'Render sky with LUTs pipeline layout',
                    bindGroupLayouts: [
                        bindGroupLayout,
                        ...(config.customUniformsSource?.bindGroupLayouts ?? []),
                    ],
                }),
                vertex: {
                    module,
                },
                fragment: {
                    module,
                    constants: makeWithLutsConstants(config, lutRenderer),
                    targets,
                },
            },
            targets.map(t => t.format),
        ];
    }
    /**
     * Asynchronously creates a {@link SkyAtmosphereComputeRenderer}.
     *
     * All pipelines used by this renderer are created asynchronously.
     *
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRasterRendererConfig} used to configure internal resources and behavior.
     * @param existingLutRenderer If this is defined, no new internal {@link SkyAtmosphereLutRenderer} will be created. Instead, the existing one is used.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static async createAsync(device, config, existingLutRenderer, existingPipelines, existingResources) {
        const useDualSourceBlending = device.features.has('dual-source-blending') && (config.skyRenderer.rayMarch?.useColoredTransmittance ?? false);
        if (!useDualSourceBlending && config.skyRenderer.rayMarch?.useColoredTransmittance) {
            console.warn('[SkyAtmosphereRasterRenderer]: dual source blending was requested but the device feature is not enabled');
        }
        const lutRenderer = existingLutRenderer ?? await SkyAtmosphereLutRenderer.createAsync(device, config, existingPipelines, existingResources);
        const bindGroupLayout = this.makeBindGroupLayout(device, config, lutRenderer.resources);
        const blendStates = this.makeBlendStates();
        const [descriptor, targetFormats] = this.makePipelineDescriptor(device, config, lutRenderer, bindGroupLayout, blendStates.single, blendStates.dual, useDualSourceBlending);
        const pipeline = await device.createRenderPipelineAsync(descriptor);
        return new SkyWithLutsRasterRenderer(targetFormats, lutRenderer, bindGroupLayout, pipeline, config);
    }
    /**
     * Creates a {@link SkyAtmosphereComputeRenderer}.
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRasterRendererConfig} used to configure internal resources and behavior.
     * @param existingLutRenderer If this is defined, no new internal {@link SkyAtmosphereLutRenderer} will be created. Instead, the existing one is used.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static create(device, config, existingLutRenderer, existingPipelines, existingResources) {
        const useDualSourceBlending = device.features.has('dual-source-blending') && (config.skyRenderer.rayMarch?.useColoredTransmittance ?? false);
        if (!useDualSourceBlending && config.skyRenderer.rayMarch?.useColoredTransmittance) {
            console.warn('[SkyAtmosphereRasterRenderer]: dual source blending was requested but the device feature is not enabled');
        }
        const lutRenderer = existingLutRenderer ?? SkyAtmosphereLutRenderer.create(device, config, existingPipelines, existingResources);
        const bindGroupLayout = this.makeBindGroupLayout(device, config, lutRenderer.resources);
        const blendStates = this.makeBlendStates();
        const [descriptor, targetFormats] = this.makePipelineDescriptor(device, config, lutRenderer, bindGroupLayout, blendStates.single, blendStates.dual, useDualSourceBlending);
        const pipeline = device.createRenderPipeline(descriptor);
        return new SkyWithLutsRasterRenderer(targetFormats, lutRenderer, bindGroupLayout, pipeline, config);
    }
    makeBindGroup(depthBuffer) {
        return makeWithLutsBindGroup(this.lutRenderer.resources, this.bindGroupLayout, this.lutRenderer.usesCustomUniforms, this.makeExternalBindGroupEntries(depthBuffer));
    }
    renderLuts(passEncoder, uniforms, atmosphere, skipDynamicLutRendering, forceConstantLutRendering, forceSkyViewLutRendering) {
        this.lutRenderer.renderLuts(passEncoder, uniforms, atmosphere, skipDynamicLutRendering ?? false, forceConstantLutRendering, forceSkyViewLutRendering);
    }
}
/**
 * A sky / atmosphere renderer that renders the sky using full-resolution ray marching.
 * It uses `GPURenderPipeline`s to render the sky / atmosphere.
 */
class SkyRayMarchRasterRenderer extends SkyRasterRenderer {
    targetFormats;
    lutRenderer;
    bindGroupLayout;
    constructor(targetFormats, lutRenderer, bindGroupLayout, pipeline, config) {
        super(targetFormats, lutRenderer, bindGroupLayout, pipeline, config, true);
        this.targetFormats = targetFormats;
        this.lutRenderer = lutRenderer;
        this.bindGroupLayout = bindGroupLayout;
    }
    static makeBindGroupLayout(device, config, resources, rayMarchDistantSky) {
        return makeRayMarchBindGroupLayout(device, config, this.makeExternalBindGroupLayoutEntries(config), resources, rayMarchDistantSky, GPUShaderStage.FRAGMENT);
    }
    static makePipelineDescriptor(device, config, lutRenderer, bindGroupLayout, rayMarchDistantSky, blendState, dualBlendState, useDualSourceBlending) {
        const useTwoTargets = config.skyRenderer.transmissionFormat && !useDualSourceBlending;
        const targets = [
            {
                format: config.skyRenderer.renderTargetFormat,
                writeMask: GPUColorWrite.ALL,
            },
        ];
        if (useTwoTargets) {
            targets.push({ format: config.skyRenderer.transmissionFormat, });
        }
        else {
            targets[0].blend = useDualSourceBlending ? dualBlendState : blendState;
        }
        let code = (rayMarchDistantSky ? makeRenderSkyRaymarchingShaderCode : makeRenderSkyLutAndRaymarchingShaderCode)('rgba16float', config.shadow?.wgslCode, config.customUniformsSource?.wgslCode, config.mieHgDrainePhase?.constantDropletDiameter);
        if (useDualSourceBlending) {
            code = code.replace('@location(0)', '@location(0) @blend_src(0)');
            code = code.replace('@location(1)', '@location(0) @blend_src(1)');
        }
        else if (targets.length !== 2) {
            code = code.replace('@location(1) transmittance: vec4<f32>,', '');
            code = code.replace('RenderSkyFragment(result.luminance, result.transmittance)', 'RenderSkyFragment(vec4<f32>(result.luminance.rgb, 1.0 - dot(result.transmittance.rgb, vec3<f32>(1.0 / 3.0))))');
        }
        const module = device.createShaderModule({
            label: 'Render sky raymarching',
            code: `${useDualSourceBlending ? 'enable dual_source_blending;\n' : ''}${code}`,
        });
        return [
            {
                label: `Render sky raymarching pipeline [${lutRenderer.resources.label}]`,
                layout: device.createPipelineLayout({
                    label: `Render sky raymarching pipeline layout [${lutRenderer.resources.label}]`,
                    bindGroupLayouts: [
                        bindGroupLayout,
                        ...(config.shadow?.bindGroupLayouts || []),
                        ...(config.customUniformsSource?.bindGroupLayouts ?? []),
                    ],
                }),
                vertex: {
                    module,
                },
                fragment: {
                    module,
                    constants: makeRayMarchConstantsBase(config, lutRenderer, rayMarchDistantSky),
                    targets,
                },
            },
            targets.map(t => t.format),
        ];
    }
    /**
     * Asynchronously creates a {@link SkyAtmosphereComputeRenderer}.
     *
     * All pipelines used by this renderer are created asynchronously.
     *
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRasterRendererConfig} used to configure internal resources and behavior.
     * @param existingLutRenderer If this is defined, no new internal {@link SkyAtmosphereLutRenderer} will be created. Instead, the existing one is used.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static async createAsync(device, config, existingLutRenderer, existingPipelines, existingResources) {
        const useDualSourceBlending = device.features.has('dual-source-blending') && (config.skyRenderer.rayMarch?.useColoredTransmittance ?? false);
        if (!useDualSourceBlending && config.skyRenderer.rayMarch?.useColoredTransmittance) {
            console.warn('[SkyAtmosphereRasterRenderer]: dual source blending was requested but the device feature is not enabled');
        }
        const rayMarchDistantSky = config.skyRenderer.rayMarch?.rayMarchDistantSky ?? true;
        const lutRenderer = existingLutRenderer ?? await SkyAtmosphereLutRenderer.createAsync(device, config, existingPipelines, existingResources);
        const bindGroupLayout = this.makeBindGroupLayout(device, config, lutRenderer.resources, rayMarchDistantSky);
        const blendStates = this.makeBlendStates();
        const [descriptor, targetFormats] = this.makePipelineDescriptor(device, config, lutRenderer, bindGroupLayout, rayMarchDistantSky, blendStates.single, blendStates.dual, useDualSourceBlending);
        const pipeline = await device.createRenderPipelineAsync(descriptor);
        return new SkyRayMarchRasterRenderer(targetFormats, lutRenderer, bindGroupLayout, pipeline, config);
    }
    /**
     * Creates a {@link SkyAtmosphereComputeRenderer}.
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRasterRendererConfig} used to configure internal resources and behavior.
     * @param existingLutRenderer If this is defined, no new internal {@link SkyAtmosphereLutRenderer} will be created. Instead, the existing one is used.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static create(device, config, existingLutRenderer, existingPipelines, existingResources) {
        const useDualSourceBlending = device.features.has('dual-source-blending') && (config.skyRenderer.rayMarch?.useColoredTransmittance ?? false);
        if (!useDualSourceBlending && config.skyRenderer.rayMarch?.useColoredTransmittance) {
            console.warn('[SkyAtmosphereRasterRenderer]: dual source blending was requested but the device feature is not enabled');
        }
        const rayMarchDistantSky = config.skyRenderer.rayMarch?.rayMarchDistantSky ?? true;
        const lutRenderer = existingLutRenderer ?? SkyAtmosphereLutRenderer.create(device, config, existingPipelines, existingResources);
        const bindGroupLayout = this.makeBindGroupLayout(device, config, lutRenderer.resources, rayMarchDistantSky);
        const blendStates = this.makeBlendStates();
        const [descriptor, targetFormats] = this.makePipelineDescriptor(device, config, lutRenderer, bindGroupLayout, rayMarchDistantSky, blendStates.single, blendStates.dual, useDualSourceBlending);
        const pipeline = device.createRenderPipeline(descriptor);
        return new SkyRayMarchRasterRenderer(targetFormats, lutRenderer, bindGroupLayout, pipeline, config);
    }
    makeBindGroup(depthBuffer) {
        return makeRayMarchBindGroup(this.lutRenderer.resources, this.bindGroupLayout, this.lutRenderer.usesCustomUniforms, this.makeExternalBindGroupEntries(depthBuffer), this.rayMarchDistantSky);
    }
    renderLuts(passEncoder, uniforms, atmosphere, skipDynamicLutRendering, forceConstantLutRendering, forceSkyViewLutRendering) {
        this.lutRenderer.renderLuts(passEncoder, uniforms, atmosphere, skipDynamicLutRendering ?? true, forceConstantLutRendering, !this.rayMarchDistantSky || forceSkyViewLutRendering);
    }
    get rayMarchDistantSky() {
        return this.doesRayMarchDistantSky;
    }
}
/**
 * A sky / atmosphere renderer that uses `GPURenderPipeline`s to render the sky / atmosphere.
 */
class SkyAtmosphereRasterRenderer {
    lutRenderer;
    withLutsRenderer;
    rayMarchRenderer;
    defaultToFullResolutionRayMarch;
    constructor(lutRenderer, withLutsRenderer, rayMarchRenderer, defaultToFullResolutionRayMarch) {
        this.lutRenderer = lutRenderer;
        this.withLutsRenderer = withLutsRenderer;
        this.rayMarchRenderer = rayMarchRenderer;
        this.defaultToFullResolutionRayMarch = defaultToFullResolutionRayMarch;
    }
    /**
     * Asynchronously creates a {@link SkyAtmosphereRasterRenderer}.
     *
     * All pipelines used by this renderer are created asynchronously.
     *
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingLutRenderer If this is defined, no new internal {@link SkyAtmosphereLutRenderer} will be created. Instead, the existing one is used.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static async createAsync(device, config, existingLutRenderer, existingPipelines, existingResources) {
        const lutRenderer = existingLutRenderer ?? await SkyAtmosphereLutRenderer.createAsync(device, config, existingPipelines, existingResources);
        const [withLutsRenderer, rayMarchRenderer] = await Promise.all([SkyWithLutsRasterRenderer.createAsync(device, config, lutRenderer), SkyRayMarchRasterRenderer.createAsync(device, config, lutRenderer)]);
        return new SkyAtmosphereRasterRenderer(lutRenderer, withLutsRenderer, rayMarchRenderer, config.skyRenderer.defaultToPerPixelRayMarch ?? false);
    }
    /**
     * Creates a {@link SkyAtmosphereRasterRenderer}.
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingLutRenderer If this is defined, no new internal {@link SkyAtmosphereLutRenderer} will be created. Instead, the existing one is used.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static create(device, config, existingLutRenderer, existingPipelines, existingResources) {
        const lutRenderer = existingLutRenderer ?? SkyAtmosphereLutRenderer.create(device, config, existingPipelines, existingResources);
        return new SkyAtmosphereRasterRenderer(lutRenderer, SkyWithLutsRasterRenderer.create(device, config, lutRenderer), SkyRayMarchRasterRenderer.create(device, config, lutRenderer), config.skyRenderer.defaultToPerPixelRayMarch ?? false);
    }
    /**
     * Replaces potentially screen-size dependent external resources (depth buffer) in the internal bind groups.
     *
     * @param depthBuffer The depth buffer to limit the ray marching distance when rendering the sky / atmosphere.
     *                    If this is a textue, a texture view will be created.
     *                    If this is a texture view, it must be allowed to be bound as a `texture<f32>`.
     *                    I.e., if the texture has a depth-stencil format, the texture view must be a `"depth-only"` view.
     */
    onResize(depthBuffer) {
        this.withLutsRenderer.onResize(depthBuffer);
        this.rayMarchRenderer.onResize(depthBuffer);
    }
    /**
     * Renders the sky / atmosphere using precomputed lookup tables.
     *
     * Requires the sky view and aerial perspective lookup tables to be initialized.
     * To initialize these lookup tables, call {@link renderDynamicLuts}.
     *
     * @param passEncoder A `GPURenderPassEncoder` or `GPURenderBundleEncoder` to encode the pass with. The encoder is not `end()`ed by this function.
     *
     * @see {@link renderDynamicLuts}: To initialize the lookup tables required, call this function.
     */
    renderSkyWithLuts(passEncoder) {
        this.withLutsRenderer.renderSky(passEncoder);
    }
    /**
     * Renders the sky / atmosphere using full-resolution ray marching.
     *
     * Requires the transmittance and multiple scattering lookup tables to be initialized.
     * Either initialize these lookup tables in the constructor using {@link SkyAtmosphereRendererConfig.initializeConstantLuts}, or call {@link renderConstantLuts}.
     *
     * @param passEncoder A `GPURenderPassEncoder` or `GPURenderBundleEncoder` to encode the pass with. The encoder is not `end()`ed by this function.
     *
     * @see {@link renderConstantLuts}: To initialize the lookup tables required, call this function.
     */
    renderSkyRaymarching(passEncoder) {
        this.rayMarchRenderer.renderSky(passEncoder);
    }
    /**
     * Renders the sky / atmosphere using either lookup tables or full-resolution ray marching, as well as all look up tables required by the respective approach.
     *
     * @param passEncoder A `GPURenderPassEncoder` or `GPURenderBundleEncoder` to encode the sky / atmosphere rendering pass with. The encoder is not `end()`ed by this function.
     * @param useFullResolutionRayMarch If this is true, full-resolution ray marching will be used to render the sky / atmosphere. Defaults to {@link defaultToFullResolutionRayMarch}.
     *
     * @see {@link renderSkyWithLuts}: Renders the sky with lookup tables.
     * @see {@link renderSkyRaymarching}: Renders the sky with full-resolution ray marching.
     */
    renderSky(passEncoder, useFullResolutionRayMarch) {
        if (useFullResolutionRayMarch ?? this.defaultToFullResolutionRayMarch) {
            this.renderSkyRaymarching(passEncoder);
        }
        else {
            this.renderSkyWithLuts(passEncoder);
        }
    }
    updateAtmosphere(atmosphere) {
        this.lutRenderer.updateAtmosphere(atmosphere);
    }
    updateUniforms(uniforms) {
        this.lutRenderer.updateUniforms(uniforms);
    }
    renderTransmittanceLut(passEncoder) {
        this.lutRenderer.renderTransmittanceLut(passEncoder);
    }
    renderMultiScatteringLut(passEncoder) {
        this.lutRenderer.renderMultiScatteringLut(passEncoder);
    }
    renderConstantLuts(passEncoder, atmosphere) {
        this.lutRenderer.renderConstantLuts(passEncoder, atmosphere);
    }
    renderSkyViewLut(passEncoder) {
        this.lutRenderer.renderSkyViewLut(passEncoder);
    }
    renderAerialPerspectiveLut(passEncoder) {
        this.lutRenderer.renderAerialPerspectiveLut(passEncoder);
    }
    renderDynamicLuts(passEncoder, uniforms) {
        this.lutRenderer.renderDynamicLuts(passEncoder, uniforms);
    }
    renderLuts(passEncoder, uniforms, atmosphere, useFullResolutionRayMarch, forceConstantLutRendering, forceSkyViewLutRendering) {
        this.lutRenderer.renderLuts(passEncoder, uniforms, atmosphere, useFullResolutionRayMarch, forceConstantLutRendering, !this.rayMarchRenderer.rayMarchDistantSky || forceSkyViewLutRendering);
    }
    get resources() {
        return this.lutRenderer.resources;
    }
}

export { ATMOSPHERE_BUFFER_SIZE, ComputePass, LookUpTable, RenderPass, SkyAtmosphereComputeRenderer, SkyAtmosphereLutRenderer, SkyAtmosphereRasterRenderer, SkyAtmosphereResources, SkyRayMarchComputeRenderer, SkyRayMarchRasterRenderer, SkyWithLutsComputeRenderer, SkyWithLutsRasterRenderer, UNIFORMS_BUFFER_SIZE, atmosphereToFloatArray, makeEarthAtmosphere, uniformsToFloatArray };
//# sourceMappingURL=webgpu-sky-atmosphere.module.js.map
