# WebGPU Sky / Atmosphere
A WebGPU implementation of Hillaire's atmosphere model ([A Scalable and Production Ready
Sky and Atmosphere Rendering Technique](https://sebh.github.io/publications/egsr2020.pdf)).
Renders the clear sky / atmosphere as a post process.

## Docs

Find the docs [here](https://jolifantobambla.github.io/webgpu-sky-atmosphere/).

Try it out [here](https://jolifantobambla.github.io/webgpu-sky-atmosphere/demo/).

## Installation

### NPM

```bash
npm install webgpu-sky-atmosphre
```

```js
import { SkyAtmosphereRenderer } from 'webgpu-sky-atmosphere';
```

### From GitHub

```js
import { SkyAtmosphereRenderer } from 'https://jolifantobambla.github.io/webgpu-sky-atmosphere/dist/1.x/webgpu-sky-atmosphere.module.min.js';
```

## Usage

### Quick Start

To render the clear sky / atmosphere, use a `SkyAtmosphereComputeRenderer`:

```js
import { SkyAtmosphereComputeRenderer } from 'webgpu-sky-atmosphere';

// during setup
const skyRenderer = new SkyAtmosphereComputeRenderer(device, {
  // configurate the renderer here
  skyRenderer: {
    backBuffer: {
      // the sky will be rendered on top of the contents of this...
      texture: afterLightingTexture,
    },
    renderTarget: {
      // ... results will be written to this texture
      texture: withSkyAppliedTexture,
    },
    depthBuffer: {
      // ...using the depth buffer to limit ray marching
      texture: depthBuffer,
    },
  }
});

// during render loop
const skyUniforms = {
  // set camera paramters, etc.
};
const skyPass = commandEncoder.beginComputePass();
skyRenderer.renderSkyAtmosphere(skyPass, skyUniforms);
skyPass.end();
```

Or, if you prefer render passes / bundles, use a `SkyAtmosphereRasterRenderer`:

```js
import { SkyAtmosphereRasterRenderer } from 'webgpu-sky-atmosphere';

// during setup
const skyRenderer = new SkyAtmosphereRasterRenderer(device, {
  // configurate the renderer here
  skyRenderer: {
    // the format of the render target at location 0
    renderTargetFormat: 'rgba16float',
    // the depth buffer is used to limit the ray marching distance
    depthBuffer: {
      texture: depthBuffer,
    }
  }
});

// during render loop
const skyUniforms = {
  // set camera paramters, etc.
};

// the lookup tables are rendered using a compute pass
const lutsPass = commandEncoder.beginComputePass();
skyRenderer.renderSkyAtmosphereLuts(lutsPass, skyUniforms);
lutsPass.end();

// the sky is then rendered using a render pass or render bundle
const skyPass = commandEncoder.beginRenderPass({
  // configure target
});
skyRenderer.renderSky(skyPass);
skyPass.end();
```

Or, if you only need the lookup tables and want to roll your own sky renderer, use a `SkyAtmosphereRenderer`:

```js
import { SkyAtmisphereRenderer } from 'webgpu-sky-atmosphere';

// during setup
const skyRenderer = new SkyAtmosphereRenderer(device, {
  // configurate the renderer here or use the defaults
});

// during render loop
const skyUniforms = {
  // set camera paramters, etc.
};
const skyPass = commandEncoder.beginComputePass();
skyRenderer.renderSkyAtmosphereLuts(skyPass, skyUniforms);
skyPass.end();
```

### Full-resolution ray marching

The above renderers default to rendering the clear sky / atmosphere using low-resolution lookup tables. However, it can also be rendered by doing a full-resolution ray marching pass.
While the former method is faster, full-resolution ray marching produces smoother volumetric shadows.

To use full-resolution ray marching instead of the faster lookup table-based approach, set the default behavior for `renderSkyAtmosphere` and `renderSky` via the config:

```js
const config = {
  skyRenderer: {
    defaultToPerPixelRayMarch: true,
  }
} 
```

Or pass the corresponding flag to `renderSkyAtmosphere` / `renderSky` directly:

```js
const useFullResolutionRayMarch = true;

skyRenderer.renderSkyAtmosphere(computePass, config, null, useFullResolutionRayMarch);

skyRenderer.renderSky(renderPass, useFullResolutionRayMarch);
```

### Lookup tables

Both sky rendering methods depend on a transmittance and a multiple scattering lookup table that are constant for a given atmosphere.
By default, these lookup tables are rendered at the time the renderer is created.
To re-render these lookup tables, e.g., if the atmosphere parameters change, call

```js
skyRenderer.renderConstantLuts(
  computePassEncoder,
  // this is optional
  // if this is undefined, the internal atmosphere parameters will not be updated
  atmosphere,
);
```

When not doing a full-resolution ray marching pass, an additional low resolution lookup table for the distant sky as well as an aerial perspective lookup table (as a volume around the camera) need to be rendered. These lookup tables are view-dependent and need to be re-rendered each frame they are used:

```js
skyRenderer.renderDynamicLuts(
  computePassEncoder,
  // passing the uniforms is optional
  // if this is undefined, the internal uniform buffer will not be updated
  uniforms,
);
```

Alternatively, each lookup table can be rendered individually.
See the documentation for more details.

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

### Custom uniform buffers

It is likely that some or even all uniforms used by a `SkyAtmosphereRenderer` are already available on the GPU in some other buffers in your engine.
To replace the `SkyAtmosphereRenderer`'s internal uniform buffer by one or more user-controlled uniform buffers, configure the renderer to inject external bind groups and WGSL code, similar to how shadows were integrated into the renderer:

```js
const config = {
    ...
    customUniformsSource: {
        bindGroupLayouts: [uniformsBindGroupLayout],
        bindGroups: [uniformsBindGroup],
        wgslCode: `
            @group(2) @binding(0) var<uniform> custom_uniform_buffer: CustomUniforms;
            
            fn get_camera_world_position() -> vec3<f32> {
              return custom_uniform_buffer.camera.position;
            }

            fn get_ray_march_min_spp() -> f32 {
              return 16.0;
            }

            // ... and so on
            
            // this needs to implement a larger interface
            // read the docs for more information
        `
    },
    ...
}
```

## Contributions

Contributions are very welcome. If you find a bug or think some important functionality is missing, please file an issue [here](https://github.com/JolifantoBambla/webgpu-sky-atmosphere/issues). If want to help out yourself, feel free to submit a pull request [here](https://github.com/JolifantoBambla/webgpu-sky-atmosphere/pulls).


## Acknowledgements

This library is originally a WebGPU port of Hillaire's [demo implementation](https://github.com/sebh/UnrealEngineSkyAtmosphere) for his paper [A Scalable and Production Ready
Sky and Atmosphere Rendering Technique](https://sebh.github.io/publications/egsr2020.pdf).
The original demo was released under the MIT licence by Epic Games, Inc.
