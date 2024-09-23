/// <reference types="dist" />
import { SkyAtmosphereComputeRendererConfig, SkyAtmosphereRasterRendererConfig, SkyAtmosphereRendererConfig } from './config.js';
import { SkyAtmosphereLutRenderer } from './lut-renderer.js';
import { SkyAtmosphereResources } from './resources.js';
export declare function makeSkyRendereringBaseLayoutEntries(config: SkyAtmosphereRendererConfig, resources: SkyAtmosphereResources, visibility: GPUShaderStageFlags): GPUBindGroupLayoutEntry[];
export declare function makeWithLutsBindGroupLayout(device: GPUDevice, config: SkyAtmosphereRendererConfig, externalEntries: GPUBindGroupLayoutEntry[], resources: SkyAtmosphereResources, visibility: GPUShaderStageFlags): GPUBindGroupLayout;
export declare function makeRayMarchBindGroupLayout(device: GPUDevice, config: SkyAtmosphereRendererConfig, externalEntries: GPUBindGroupLayoutEntry[], resources: SkyAtmosphereResources, rayMarchDistantSky: boolean, visibility: GPUShaderStageFlags): GPUBindGroupLayout;
export declare function makeSkyRenderingBindGroupLayouts(device: GPUDevice, config: SkyAtmosphereRendererConfig, externalEntries: GPUBindGroupLayoutEntry[], resources: SkyAtmosphereResources, rayMarchDistantSky: boolean, visibility: GPUShaderStageFlags): [GPUBindGroupLayout, GPUBindGroupLayout];
export declare function makeSkyRenderingBaseEntries(resources: SkyAtmosphereResources, customUniforms: boolean): GPUBindGroupEntry[];
export declare function makeWithLutsBindGroup(resources: SkyAtmosphereResources, layout: GPUBindGroupLayout, customUniforms: boolean, externalEntries: GPUBindGroupEntry[]): GPUBindGroup;
export declare function makeRayMarchBindGroup(resources: SkyAtmosphereResources, layout: GPUBindGroupLayout, customUniforms: boolean, externalEntries: GPUBindGroupEntry[], rayMarchDistantSky: boolean): GPUBindGroup;
export declare function makeSkyRenderingBindGroups(resources: SkyAtmosphereResources, withLutsLayout: GPUBindGroupLayout, rayMarchLayout: GPUBindGroupLayout, customUniforms: boolean, externalEntries: GPUBindGroupEntry[], rayMarchDistantSky: boolean): [GPUBindGroup, GPUBindGroup];
export declare function makeWithLutsConstants(config: SkyAtmosphereComputeRendererConfig | SkyAtmosphereRasterRendererConfig, lutRenderer: SkyAtmosphereLutRenderer): Record<string, GPUPipelineConstantValue>;
export declare function makeRayMarchConstantsBase(config: SkyAtmosphereComputeRendererConfig | SkyAtmosphereRasterRendererConfig, lutRenderer: SkyAtmosphereLutRenderer, rayMarchDistantSky: boolean): Record<string, GPUPipelineConstantValue>;
