# webgpu-sky-atmosphere
A WebGPU implementation of Hillaire's atmosphere model ([A Scalable and Production Ready
Sky and Atmosphere Rendering Technique](https://sebh.github.io/publications/egsr2020.pdf)).
Renders the clear sky / atmosphere as a post process.

## Docs

Find the docs [here](https://jolifantobambla.github.io/webgpu-sky-atmosphere/).

Try it out [here](https://jolifantobambla.github.io/webgpu-sky-atmosphere/demo/).

## Installation

### NPM

```
npm install webgpu-sky-atmosphre
```

```
import { SkyAtmosphereRenderer } from 'webgpu-sky-atmosphere';
```

### From GitHub

```
import { WebGPUSinglePassDownsampler } from 'https://jolifantobambla.github.io/webgpu-sky-atmosphere/dist/1.x/webgpu-sky-atmosphere.module.min.js';
```

## Usage

The `SkyAtmosphereRenderer` comes in two flavors:
 * `SkyAtmosphereComputeRenderer`: renders the sky / atmosphere using a compute pass.
 * `SkyAtmosphereRasterRenderer`: render the sky / atmosphere using a render (rasterization) pass.

### Light sources

Theoretically, an arbitrary number of light sources could influence the atmosphere. However, for performance reasons, only up to two directional light sources are considered.

By default, only one light source is used. To also use the second one, use the `lights` property of the config:
```js
const config = {
    ...
    lights: {
        useMoon: true,
    },
    ...
}
```

#### Sun disk rendering

A simple implementation for rendering a sun and a moon disk is provided by the `SkyAtmosphereRenderer`.
The provided implementation can be disabled using the `lights` property of the config:

```js
const config = {
    ...
    lights: {
        renderSunDisk: false,
    },
    ...
}
```

#### Integrating shadows

User-controlled shadowing can be integrated into a `SkyAtmosphereRenderer` by injecting bind groups and WGSL code into the sky / atmosphere rendering pipelines and shaders via the `shadow` property of the `SkyAtmosphereConfig` used to create the renderer.

Most importantly, the WGSL code provided by the config must implement the following function:

```wgsl
fn get_shadow(world_space_position: vec3<f32>, light_index: u32) -> f32
```

Internally, `get_shadow` will be called for each ray marching sample.
It should return a floating point value in the range [0, 1], where 1 implies that the world space position given (`world_space_position`) is not in shadow.
The `light_index` parameter refers to the index of the atmosphere light, where `0` refers to the sun and `1` refers to the moon.
Additionally, the WGSL code should also define all external bind groups required by the shadowing implementation.

Except for the `get_shadow` interface, the `SkyAtmosphereRenderer` is agnostic to the shadowing technique used.

For example, for a simple shadow map for just the sun, this could look like this:
```js
const config = {
    ...
    shadow: {
        bindGroupLayouts: [shadowBindGroupLayout],
        bindGroups: [device.createBindGroup({
            label: 'shadow',
            layout: shadowBindGroupLayout,
            entries: [
                {binding: 0, resource: {buffer: sunViewProjectionBuffer}},
                {binding: 1, resource: device.createSampler({compare: 'less'})},
                {binding: 2, resource: shadowMapView},
            ],
        })],
        wgslCode: `
            @group(1) @binding(0) var<uniform> sun_view_projection: mat4x4<f32>;
            @group(1) @binding(1) var shadow_sampler: sampler_comparison;
            @group(1) @binding(2) var shadow_map: texture_depth_2d;
            
            fn get_shadow(p: vec3<f32>, light_index: u32) -> f32 {
                if light_index == 0 {
                    var shadow_pos = (sun_view_projection * vec4(p, 1.0)).xyz;
                    shadow_pos = vec3(shadow_pos.xy * vec2(0.5, -0.5) + 0.5, shadow_pos.z);
                    if all(shadow_pos >= vec3<f32>()) && all(shadow_pos < vec3(1.0)) {
                        return textureSampleCompareLevel(shadow_map, shadow_sampler, shadow_pos.xy, shadow_pos.z);
                    }
                }
                return 1.0;
            }
        `
    },
    ...
}
```


