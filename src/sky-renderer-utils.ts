/*
 * Copyright (c) 2024 Lukas Herzberger
 * SPDX-License-Identifier: MIT
 */

import { SkyAtmosphereComputeRendererConfig, SkyAtmosphereRasterRendererConfig, SkyAtmosphereRendererConfig } from './config.js';
import { SkyAtmosphereLutRenderer } from './lut-renderer.js';
import { ATMOSPHERE_BUFFER_SIZE, SkyAtmosphereResources, UNIFORMS_BUFFER_SIZE } from './resources.js';

export function makeSkyRendereringBaseLayoutEntries(config: SkyAtmosphereRendererConfig, resources: SkyAtmosphereResources, visibility: GPUShaderStageFlags): GPUBindGroupLayoutEntry[] {
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
    ].filter(e => e !== undefined) as GPUBindGroupLayoutEntry[];
}

export function makeWithLutsBindGroupLayout(device: GPUDevice, config: SkyAtmosphereRendererConfig, externalEntries: GPUBindGroupLayoutEntry[], resources: SkyAtmosphereResources, visibility: GPUShaderStageFlags): GPUBindGroupLayout {
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
        }) as GPUBindGroupLayoutEntry[],
    });
}

export function makeRayMarchBindGroupLayout(device: GPUDevice, config: SkyAtmosphereRendererConfig, externalEntries: GPUBindGroupLayoutEntry[], resources: SkyAtmosphereResources, rayMarchDistantSky: boolean, visibility: GPUShaderStageFlags): GPUBindGroupLayout {
    const renderSkyBindGroupLayoutBaseEntries = makeSkyRendereringBaseLayoutEntries(config, resources, visibility);
    return device.createBindGroupLayout({
        label: `Render sky raymarching bind group layout [${resources.label}]`,
        entries: ([
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
        ].filter(e => e !== undefined) as GPUBindGroupLayoutEntry[])
        .map((v, i) => {
            v.binding = i;
            return v;
        }) as GPUBindGroupLayoutEntry[],
    });
}

export function makeSkyRenderingBindGroupLayouts(device: GPUDevice, config: SkyAtmosphereRendererConfig, externalEntries: GPUBindGroupLayoutEntry[], resources: SkyAtmosphereResources, rayMarchDistantSky: boolean, visibility: GPUShaderStageFlags): [GPUBindGroupLayout, GPUBindGroupLayout] {
    return [
        makeWithLutsBindGroupLayout(device, config, externalEntries, resources, visibility),
        makeRayMarchBindGroupLayout(device, config, externalEntries, resources, rayMarchDistantSky, visibility),
    ];
}

export function makeSkyRenderingBaseEntries(resources: SkyAtmosphereResources, customUniforms: boolean): GPUBindGroupEntry[] {
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
    ].filter(e => e !== undefined) as GPUBindGroupEntry[];
}

export function makeWithLutsBindGroup(resources: SkyAtmosphereResources, layout: GPUBindGroupLayout, customUniforms: boolean, externalEntries: GPUBindGroupEntry[]): GPUBindGroup {
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
        }) as GPUBindGroupEntry[],
    });
}

export function makeRayMarchBindGroup(resources: SkyAtmosphereResources, layout: GPUBindGroupLayout, customUniforms: boolean, externalEntries: GPUBindGroupEntry[], rayMarchDistantSky: boolean): GPUBindGroup {
    return resources.device.createBindGroup({
        label: `Render sky raymarching bind group [${resources.label}]`,
        layout: layout,
        entries: ([
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
        ].filter(e => e !== undefined) as GPUBindGroupEntry[])
        .map((v, i) => {
            v.binding = i;
            return v;
        }) as GPUBindGroupEntry[],
    });
}

export function makeSkyRenderingBindGroups(resources: SkyAtmosphereResources, withLutsLayout: GPUBindGroupLayout, rayMarchLayout: GPUBindGroupLayout, customUniforms: boolean, externalEntries: GPUBindGroupEntry[], rayMarchDistantSky: boolean): [GPUBindGroup, GPUBindGroup] {
    return [
        makeWithLutsBindGroup(resources, withLutsLayout, customUniforms, externalEntries),
        makeRayMarchBindGroup(resources, rayMarchLayout, customUniforms, externalEntries, rayMarchDistantSky),
    ];
}

export function makeWithLutsConstants(config: SkyAtmosphereComputeRendererConfig | SkyAtmosphereRasterRendererConfig, lutRenderer: SkyAtmosphereLutRenderer): Record<string, GPUPipelineConstantValue> {
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

export function makeRayMarchConstantsBase(config: SkyAtmosphereComputeRendererConfig | SkyAtmosphereRasterRendererConfig, lutRenderer: SkyAtmosphereLutRenderer, rayMarchDistantSky: boolean): Record<string, GPUPipelineConstantValue> {
    const constants: Record<string, GPUPipelineConstantValue> = {
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
    };
    if (!rayMarchDistantSky) {
        constants['SKY_VIEW_LUT_RES_X'] = lutRenderer.resources.skyViewLut.texture.width;
        constants['SKY_VIEW_LUT_RES_Y'] = lutRenderer.resources.skyViewLut.texture.height;
    }
    return constants;
}