import configWgsl from './shaders/common/config.wgsl';
import constantsWgsl from './shaders/common/constants.wgsl';
import intersectionWgsl from './shaders/common/intersection.wgsl';
import mediumWgsl from './shaders/common/medium.wgsl';
import phaseWgsl from './shaders/common/phase.wgsl';
import uvWgsl from './shaders/common/uv.wgsl';

import renderTransmittanceLutWgsl from './shaders/render_transmittance_lut.wgsl';
import renderMultiScatteringLutWgsl from './shaders/render_multi_scattering_lut.wgsl';
import renderSkyViewLutWgsl from './shaders/render_sky_view_lut.wgsl';

export function makeTransmittanceLutShaderCode() {
    return `${constantsWgsl}\n${intersectionWgsl}\n${mediumWgsl}\n${renderTransmittanceLutWgsl}`;
}

export function makeMultiScatteringLutShaderCode() {
    return `${constantsWgsl}\n${intersectionWgsl}\n${mediumWgsl}\n${phaseWgsl}\n${uvWgsl}\n${renderMultiScatteringLutWgsl}`;
}

export function makeSkyViewLutShaderCode() {
    return `${constantsWgsl}\n${intersectionWgsl}\n${mediumWgsl}\n${phaseWgsl}\n${uvWgsl}\n${configWgsl}\n${renderSkyViewLutWgsl}`;
}
