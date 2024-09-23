/*
 * Copyright (c) 2024 Lukas Herzberger
 * SPDX-License-Identifier: MIT
 */

import { Atmosphere } from './atmosphere.js';

import { SkyAtmosphereRendererConfig } from './config.js';

import { Uniforms } from './uniforms.js';
import { SkyAtmosphereResources } from './resources.js';

import { SkyAtmospherePipelines as SkyAtmosphereLutPipelines } from './pipelines.js';
import { ComputePass } from './util.js';

export interface SkyAtmosphereRenderer {
    /**
     * Updates the renderer's internal uniform buffer containing the {@link Atmosphere} parameters as well as its host-side copy of {@link Atmosphere} parameters.
     * @param atmosphere The new {@link Atmosphere} to override the current parameters.
     *
     * @see {@link SkyAtmosphereResources.updateAtmosphere}: Updates the host-side {@link Atmosphere} parameters as well as the corresponding uniform buffer.
     */
    updateAtmosphere(atmosphere: Atmosphere): void;

    /**
     * Updates the renderer's internal uniform buffer containing the {@link Uniforms} as well as its host-side copy of {@link Uniforms}.
     * @param uniforms The new {@link Uniforms} to override the current parameters.
     *
     * If custom uniform buffers are used, this does nothing (see {@link CustomUniformsSourceConfig}).
     *
     * @see {@link SkyAtmosphereResources.updateUniforms}: Update the {@link Uniforms} uniform buffers.
     */
    updateUniforms(uniforms: Uniforms): void;

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
    renderTransmittanceLut(passEncoder: GPUComputePassEncoder): void;

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
    renderMultiScatteringLut(passEncoder: GPUComputePassEncoder): void;

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
    renderConstantLuts(passEncoder: GPUComputePassEncoder, atmosphere?: Atmosphere): void;

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
    renderSkyViewLut(passEncoder: GPUComputePassEncoder): void;

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
    renderAerialPerspectiveLut(passEncoder: GPUComputePassEncoder): void;

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
    renderDynamicLuts(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms): void;

    /**
     * Renders the lookup tables required for rendering the sky / atmosphere.
     *
     * To initialize or update the transmittance and multiple scattering lookup tables, pass new {@link Atmosphere} paramters to this function or use the `forceConstantLutRendering` parameter.
     *
     * @param passEncoder A `GPUComputePassEncoder` to encode passes with. The encoder is not `end()`ed by this function.
     * @param uniforms {@link Uniforms} to use for this frame. If this is given, the internal uniform buffer will be updated using {@link updateUniforms}.
     * @param atmosphere {@link Atmosphere} parameters to use for this frame. If this is given, the internal uniform buffer storing the {@link Atmosphere} parameters will be updated and the transmittance and multiple scattering lookup tables will be rendered.
     * @param skipDynamicLutRendering If this is true, the sky view and aerial perspective lookup tables will not be rendered.
     * @param forceConstantLutRendering If this is true, the transmittance and multiple scattering lookup tables will be rendered regardless of whether the `atmosphere` parameter is `undefined` or not.
     * @param forceSkyViewLutRendering If this is true, the sky view lookup table will be rendered, even if {@link skipDynamicLutRendering} is true. Defaults to false.
     *
     * @see {@link renderConstantLuts}: Renders the lookup tables that are constant for a given {@link Atmosphere}.
     * @see {@link updateUniforms}: Updates the internal {@link Uniforms} uniform buffer.
     * @see {@link renderDynamicLuts}: Renders the view-dependent lookup tables.
     * @see {@link renderSkyViewLut}: Renders the sky view lookup table.
     */
    renderLuts(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms, atmosphere?: Atmosphere, skipDynamicLutRendering?: boolean, forceConstantLutRendering?: boolean, forceSkyViewLutRendering?: boolean): void;
}

export class SkyAtmosphereLutRenderer implements SkyAtmosphereRenderer {
    protected constructor(
        readonly resources: SkyAtmosphereResources,
        readonly pipelines: SkyAtmosphereLutPipelines,
        public skipDynamicLutRendering: boolean,
        readonly usesCustomUniforms: boolean,
        protected transmittanceLutPass: ComputePass,
        protected multiScatteringLutPass: ComputePass,
        protected skyViewLutPass: ComputePass,
        protected aerialPerspectiveLutPass: ComputePass,
    ) {}

    /**
     * Creates a {@link SkyAtmosphereLutRenderer}.
     * @param device The `GPUDevice` used to create internal resources (textures, pipelines, etc.).
     * @param config A {@link SkyAtmosphereRendererConfig} used to configure internal resources and behavior.
     * @param existingPipelines If this is defined, no new pipelines for rendering the internal lookup tables will be created. Instead, the existing pipelines given will be reused. The existing pipelines must be compatible with the {@link SkyAtmosphereRendererConfig}. Especially, {@link SkyAtmosphereRendererConfig.lookUpTables} and {@link SkyAtmosphereRendererConfig.shadow} should be the same.
     * @param existingResources If this is defined, no new resources (buffers, textures, samplers) will be created. Instead, the existing resources given will be used.
     */
    static create(device: GPUDevice, config: SkyAtmosphereRendererConfig, existingPipelines?: SkyAtmosphereLutPipelines, existingResources?: SkyAtmosphereResources): SkyAtmosphereLutRenderer {
        let skyAtmospherePipelines;
        if ((existingPipelines?.transmittanceLutPipeline.device || device) !== device) {
            skyAtmospherePipelines = SkyAtmosphereLutPipelines.create(device, config);
        } else {
            skyAtmospherePipelines = existingPipelines || SkyAtmosphereLutPipelines.create(device, config);
        }

        const defaultToPerPixelRayMarch = config.skyRenderer?.defaultToPerPixelRayMarch ?? false;
        const usesCustomUniforms = config.customUniformsSource !== undefined;

        const resources = existingResources || new SkyAtmosphereResources(device, config);

        const transmittanceLutPass = skyAtmospherePipelines.transmittanceLutPipeline.makeComputePass(resources);
        const multiScatteringLutPass = skyAtmospherePipelines.multiScatteringLutPipeline.makeComputePass(resources);
        const skyViewLutPass = skyAtmospherePipelines.skyViewLutPipeline.makeComputePass(resources, (config.lookUpTables?.skyViewLut?.affectedByShadow ?? true) ? config.shadow?.bindGroups : undefined, config.customUniformsSource?.bindGroups);
        const aerialPerspectiveLutPass = skyAtmospherePipelines.aerialPerspectiveLutPipeline.makeComputePass(resources, (config.lookUpTables?.aerialPerspectiveLut?.affectedByShadow ?? true) ? config.shadow?.bindGroups : undefined, config.customUniformsSource?.bindGroups);

        const lutRenderer = new SkyAtmosphereLutRenderer(
            resources,
            skyAtmospherePipelines,
            defaultToPerPixelRayMarch,
            usesCustomUniforms,
            transmittanceLutPass,
            multiScatteringLutPass,
            skyViewLutPass,
            aerialPerspectiveLutPass,
        );

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
    static async createAsync(device: GPUDevice, config: SkyAtmosphereRendererConfig, existingPipelines?: SkyAtmosphereLutPipelines, existingResources?: SkyAtmosphereResources): Promise<SkyAtmosphereLutRenderer> {
        let skyAtmospherePipelines;
        if ((existingPipelines?.transmittanceLutPipeline.device || device) !== device) {
            skyAtmospherePipelines = await SkyAtmosphereLutPipelines.createAsync(device, config);
        } else {
            skyAtmospherePipelines = existingPipelines || await SkyAtmosphereLutPipelines.createAsync(device, config);
        }
        return this.create(device, config, skyAtmospherePipelines, existingResources);
    }

    /**
     * Updates the renderer's internal uniform buffer containing the {@link Atmosphere} parameters as well as its host-side copy of {@link Atmosphere} parameters.
     * @param atmosphere The new {@link Atmosphere} to override the current parameters.
     *
     * @see {@link SkyAtmosphereResources.updateAtmosphere}: Updates the host-side {@link Atmosphere} parameters as well as the corresponding uniform buffer.
     */
    public updateAtmosphere(atmosphere: Atmosphere) {
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
    public updateUniforms(uniforms: Uniforms) {
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
    public renderTransmittanceLut(passEncoder: GPUComputePassEncoder) {
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
    public renderMultiScatteringLut(passEncoder: GPUComputePassEncoder) {
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
    public renderConstantLuts(passEncoder: GPUComputePassEncoder, atmosphere?: Atmosphere) {
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
    public renderSkyViewLut(passEncoder: GPUComputePassEncoder) {
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
    public renderAerialPerspectiveLut(passEncoder: GPUComputePassEncoder) {
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
    public renderDynamicLuts(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms) {
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
    public renderLuts(passEncoder: GPUComputePassEncoder, uniforms?: Uniforms, atmosphere?: Atmosphere, skipDynamicLutRendering?: boolean, forceConstantLutRendering?: boolean, forceSkyViewLutRendering?: boolean) {
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
        } else {
            this.renderDynamicLuts(passEncoder, uniforms);
        }
    }
}
