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
import { WebGPUSinglePassDownsampler } from 'https://jolifantobambla.github.io/webgpu-sky-atmosphere/dist/1.x/webgpu-sky-atmosphere.module.min.js';
```

## Usage

To render the clear sky / atmosphere, use a `SkyAtmosphereComputeRenderer`:

```js
import { SkyAtmisphereComputeRenderer } from 'webgpu-sky-atmosphere';

// during setup
const skyRenderer = new SkyAtmosphereComputeRenderer(device, {
  // configurate the renderer here
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
import { SkyAtmisphereRasterRenderer } from 'webgpu-sky-atmosphere';

// during setup
const skyRenderer = new SkyAtmosphereRasterRenderer(device, {
  // configurate the renderer here
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
  // configurate the renderer here
});

// during render loop
const skyUniforms = {
  // set camera paramters, etc.
};
const skyPass = commandEncoder.beginComputePass();
skyRenderer.renderSkyAtmosphereLutd(skyPass, skyUniforms);
skyPass.end();
```

The above renderers default to rendering the clear sky / atmosphere using low-resolution lookup tables. However, it can also be rendered by doing a full-resolution ray marching pass.
While the former method is faster, full-resolution ray marching produces smoother volumetric shadows.

Both methods depend on a transmittance and a multiple scattering lookup table that are constant for a given atmosphere.
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

When not doing a full-screen ray marching pass, an additional low resolution lookup table for the distant sky as well as an aerial perspectivr lookup table (as a  volume around the camera) need to be rendered. These lookup tables are view-dependent and need to be re-rendered each frame they are used:

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

The `SkyAtmosphereRenderer` comes in two flavors:
 * `SkyAtmosphereComputeRenderer`: renders the sky / atmosphere using a compute pass.
 * `SkyAtmosphereRasterRenderer`: render the sky / atmosphere using a render (rasterization) pass.

### Using render passes / bundles

The `SkyAtmosphereRasterRenderer` renders the sky using a render pass or render bundle.
However, the lookup tables are still rendered using compute passes.

To render the loopup tables and the sky call:

```js
const uniforms = {
  ... // set uniforms
}

// first render the lookup tables
const computePassEncoder = commandEncoder.beginComputePass();
skyRenderer.renderAtmosphere(computePassEncoder, uniforms);
computePassEncoder.end();

// then render the sky using a render pass
const renderPass = commandEncoder.beginRenderPass({
  color: [{
    ...
  }],
});
skyRenderer.renderSky(renderPass);
renderPass.end();

// alternatively, use a render bundle
const renderBundle ...

```

### Using compute passes

The `SkyAtmosphereComputeRenderer` renders both the internal lookup tables using compute passes.

To render the lookup tables and the sky using a single compute pass encoder call `renderSkyAtmosphere`:

```js
const uniforms = {
  ... // set uniforms
}

const computePassEncoder = commandEncoder.beginComputePass();
skyRenderer.renderSkyAtmosphere(computePassEncoder, uniforms);
computePassEncoder.end();
```

Alternatively, all lookup tables can be rendered individually.
Read the docs for more details.

To create a `SkyAtmosphereComputeRenderer` configure the `skyRenderer.passConfig` property as a `SkyAtmosphereComputePassConfig`:

```js
const skyRenderer = SkyAtmosphererRenderer.makeSkyAtmosphereRenderer({
  skyRenderer: {
    passConfig: {
      backBuffer: {},
      renderTarget: {},
    },
    depthBuffer: {},
  },
});
```

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


