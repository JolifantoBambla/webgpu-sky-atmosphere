# WebGPU Sky / Atmosphere
A WebGPU implementation of Hillaire's atmosphere model ([A Scalable and Production Ready
Sky and Atmosphere Rendering Technique](https://sebh.github.io/publications/egsr2020.pdf)).
Renders the clear sky / atmosphere for both ground and space views as a post process.


## Docs

Find the docs [here](https://jolifantobambla.github.io/webgpu-sky-atmosphere/).

Or try the [demo](https://jolifantobambla.github.io/webgpu-sky-atmosphere/demo/) (requires WebGPU support).
It comes in multiple flavors:
 - [Cornette-Shanks for Mie scattering](https://jolifantobambla.github.io/webgpu-sky-atmosphere/demo/)
 - [Henyey-Greenstein + Draine for Mie scattering](https://jolifantobambla.github.io/webgpu-sky-atmosphere/demo/?hg_draine)
 - [Two suns, Cornette-Shanks](https://jolifantobambla.github.io/webgpu-sky-atmosphere/demo/?two_suns&uniform_sky_view)
 - [Two suns, Henyey-Greenstein + Draine](https://jolifantobambla.github.io/webgpu-sky-atmosphere/demo/?two_suns&uniform_sky_view&hg_draine)
 - [Timings, Cornette-Shanks](https://jolifantobambla.github.io/webgpu-sky-atmosphere/demo/?timestamp_query)
 - [Timings, Henyey-Greenstein + Draine](https://jolifantobambla.github.io/webgpu-sky-atmosphere/demo/?timestamp_query&hg_draine)


## Installation

### NPM

```bash
npm install webgpu-sky-atmosphere
```

```js
import { SkyAtmosphereLutRenderer } from 'webgpu-sky-atmosphere';
```

### From GitHub

```js
import { SkyAtmosphereLutRenderer } from 'https://jolifantobambla.github.io/webgpu-sky-atmosphere/dist/1.x/webgpu-sky-atmosphere.module.min.js';
```

## Usage

### Quick Start

To render the clear sky / atmosphere, use a `SkyAtmosphereComputeRenderer`:

```js
import { SkyAtmosphereComputeRenderer } from 'webgpu-sky-atmosphere';

// during setup
const skyRenderer = SkyAtmosphereComputeRenderer.create(device, {
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
  },
});

// or use the async version that initializes all pipelines asynchronously
const skyRenderer = await SkyAtmosphereComputeRenderer.createAsync(device, { /* config */ });


// during render loop
const skyUniforms = {
  camera: {
    position: [ /* world space position */ ],
    inverseView: [ /* inverse view matrix */ ],
    inverseProjection: [ /*inverse projection matrix */ ],
  },
  screenResolution: [ /* width, height */ ],
  sun: {
    direction: [ /* normalized direction to the sun */ ],
  },
};
const skyPass = commandEncoder.beginComputePass();
skyRenderer.renderLutsAndSky(skyPass, skyUniforms);
skyPass.end();


// and in case of a resolution change: 
skyRenderer.onResize({
  depthBuffer,
  backBuffer,
  renderTarget,
});
```

Or, if you prefer render passes / bundles, use a `SkyAtmosphereRasterRenderer`:

```js
import { SkyAtmosphereRasterRenderer } from 'webgpu-sky-atmosphere';

// during setup
const renderTargetFormat = 'rgba16float';
const skyRenderer = SkyAtmosphereRasterRenderer.create(device, {
  // configurate the renderer here
  skyRenderer: {
    // the format of the render target at location 0
    renderTargetFormat,
    // the depth buffer is used to limit the ray marching distance
    depthBuffer: {
      texture: depthBuffer,
    },
  },
});

// or use the async version that initializes all pipelines asynchronously
const skyRenderer = await SkyAtmosphereRasterRenderer.createAsync(device, { /* config */ });


// during render loop
const skyUniforms = {
  // set camera paramters, etc.
};

// the lookup tables are rendered using a compute pass
const lutsPass = commandEncoder.beginComputePass();
skyRenderer.renderLuts(lutsPass, skyUniforms);
lutsPass.end();

// the sky is then rendered using a render pass
const skyPass = commandEncoder.beginRenderPass({
  // configure target
});
skyRenderer.renderSky(skyPass);
skyPass.end();


// alternatively prepare a render bundle ahead of time, possibly including more post-processes
const postProcessEncoder = device.createRenderBundleEncoder({
  colorFormats: [renderTargetFormat],
});
skyRenderer.renderSky(postProcessEncoder);
// .. encode other post processes that match the bundle's layout
const postProcessBundle = postProcessEncoder.finish();

// and during render loop
const postProcessPass = commandEncoder.beginRenderPass({ /* ... */ });
postProcessPass.exectuteBundles([postProcessBundle]);
postProcessPass.end();


// and in case of a resolution change: 
skyRenderer.onResize(depthBuffer);
```

The sky rendering post process depends on a couple of internally managed lookup tables.
If you only need the lookup tables and want to roll your own sky renderer, use a `SkyAtmosphereLutRenderer`:

```js
import { SkyAtmosphereLutRenderer } from 'webgpu-sky-atmosphere';

// during setup
const skyRenderer = SkyAtmosphereLutRenderer.create(device, {
  // configurate the renderer here or use the defaults
});

// or use the async version that initializes all pipelines asynchronously
const skyRenderer = await SkyAtmosphereLutRenderer.createAsync(device, { /* config */ });


// during render loop
const skyUniforms = {
  // set camera paramters, etc.
};
const skyPass = commandEncoder.beginComputePass();
skyRenderer.renderLuts(skyPass, skyUniforms);
skyPass.end();
```

### Full-resolution ray marching

The above renderers default to rendering the clear sky / atmosphere using low-resolution lookup tables. However, it can also be rendered by doing a full-resolution ray marching pass.
While the former method is faster, full-resolution ray marching produces smoother volumetric shadows and allows for colored transmittance.
It also produces a much smoother transition when moving from the top layers of the atmosphere to outer space
A typical scenario would be to switch to full-resolution ray marching if the camera is above a certain altitude threshold by passing the corresponding flag to `renderLutsAndSky` / `renderSky`:

```js
const useFullResolutionRayMarch = /* true if camera is above altitude threshold */;

skyRenderer.renderLutsAndSky(computePass, config, null, useFullResolutionRayMarch);

skyRenderer.renderSky(renderPass, useFullResolutionRayMarch);
```

To use full-resolution ray marching instead of the faster lookup table-based approach by default, change the default behavior via the config:

```js
const config = {
  skyRenderer: {
    defaultToPerPixelRayMarch: true,
  },
  ...
};
```

In addition to the two sky rendering methods, it is also possible to use a lookup table for the distant sky while doing a per-pixel ray march for each pixel with a valid depth buffer value.
While this is cheaper than doing a full-resolution ray march, volumetric shadows will not be rendered for distant sky pixels.
To enable this hybrid mode, set up the config like this:

```js
const config = {
  skyRenderer: {
    rayMarch: {
      rayMarchDistantSky: false,
    },
    ...
  },
  ...
};
```

#### Single-pipeline renderers

Both `SkyAtmosphereComputeRenderer` and `SkyAtmosphereRasterRenderer` internally manage two sky rendering pipelines, one for each sky rendering method.
To create a renderer with only one pipeline, use the following variants:

```js
const skyRenderer = SkyRayMarchComputeRenderer.create(device, { /* config */ });
const skyRenderer = SkyWithLutsComputeRenderer.create(device, { /* config */ });

const skyRenderer = SkyRayMarchRasterRenderer.create(device, { /* config */ });
const skyRenderer = SkyWithLutsRasterRenderer.create(device, { /* config */ });
```

### Atmosphere model

The atmosphere of a telluric planet, i.e., a planet with a solid planetery surface, is modelled by three components:

 * Rayleigh theory models the wavelength dependent scattering of light interacting with tiny air molecules. In Earth's atmosphere, it is ressponsible for the blue color of the sky.
 * Mie theory models how light is scattered around and absorbed by larger aerosols like dust or pollution. It is almost independent of wavelength and most of the incoming light is scattered in the forward direction. In Earth's atmosphere, it is responsible for the white glare around the sun.
 * Extra absorption layers: On Earth, light is also absorbed by the ozone in the atmosphere contributing to the sky's blue color when the sun is low.

By default, the sky renderers will use an Earth-like atmosphere with the origin on the planet's top pole, created with...

```js
const atmosphere = makeEarthAtmosphere();
```

To create a custom atmosphere, adjust the parameters to your liking (read the [docs](https://jolifantobambla.github.io/webgpu-sky-atmosphere/interfaces/Atmosphere) for more information on the indivdual parameters of an `Atmosphere`):

```js
const config = {
  atmosphere: {
    rayleigh: { /* ... */ },
    mie: { /* ... */ },
    absorption: { /* ... */ },
    ...
  },
  ...
};
```

All atmosphere parameters can be updated at runtime:

```js
// passing an atmosphere to renderLutsAndSky or renderLuts will automatically update the atmosphere and corresponding lookup tables
skyRenderer.renderLutsAndSky(passEncoder, uniforms, newAtmosphere);

skyRenderer.renderLuts(passEnoder, uniforms, newAtmosphere);


// alternatively, update the atmosphere parameters first and re-render the corresponding lookup tables later
skyRenderer.updateAtmosphere(newAtmosphere);
// ... later
skyRenderer.renderConstantLuts(passEncoder);
```

#### Mie phase approximation

Two approximations of the Mie phase function are supported:
 - Cornette-Shanks (default) (see it [live](https://jolifantobambla.github.io/webgpu-sky-atmosphere/demo/))
 - Henyey-Greenstein + Draine as published by [Jendersie and d'Eon](https://research.nvidia.com/labs/rtr/approximate-mie/) (see it [live](https://jolifantobambla.github.io/webgpu-sky-atmosphere/demo/?hg_draine))

To switch to the Henyey-Greenstein + Draine approximation use the `mieHgDrainePhase` config parameter:

```js
// use the default constant droplet diameter for the Mie phase approximation
// in this case, the atmosphere's `mie.phaseParam` is ignored
const config = {
  mieHgDrainePhase: {},
  ...
};

// or: override the constant droplet diameter
// in this case, the atmosphere's `mie.phaseParam` is ignored
const config = {
  mieHgDrainePhase: {
    constantDropletDiameter: 3.6,
  },
  ...
};

// or: allow changing the droplet diameter at runtime
// in this case, the atmosphere's `mie.phaseParam` is interpreted as the droplet diameter size
const config = {
  mieHgDrainePhase: {
    useConstantDropletDiameter: true,
  },
  ...
};
```

#### Scale
All sky renderers use the distance scale 1 = 1km.

To adjust the scale of the atmosphere to correspond your engine's scale, e.g., 1 = 1m, set

```js
const config = {
  fromKilometersScale: 1000.0,
  ...
};
```

#### Positioning the atmosphere

To initialize an Earth-like atmosphere to use a different origin, use 

```js
// using a specific center
const center = [ /* world space position of the planet's center */ ];
const config = {
  atmosphere: makeEarthAtmosphere(center),
  ...
};

// using the default center (origin is on the top pole) but with the z axis pointing up
const yUp = false;
const config = {
  atmosphere: makeEarthAtmosphere(null, yUp),
  ...
};
```

### Light sources

Theoretically, an arbitrary number of light sources could influence the atmosphere. However, for performance reasons, only up to two directional light sources are considered.

At runtime, light source parameters are set through `Uniforms` passed to the renderer:

```js
const uniforms = {
  sun: {
    direction: [ /* normalized direction to the light source */ ],
    illuminance: [ /* illuminance at the top of the atmosphere */ ],
  },
  moon: {
    // has same structure as the sun  
  },
  ...
};
skyRenderer.renderLutsAndSky(passEncoder, uniforms);
```

By default, only one light source is used. A second light source can be enabled via the config's `lights.useMoon` property.

When using multiple light sources, it is recommended to change the default parameterization of the sky view lookup table.  
The default parameterization assumes a single dominant light source with symmetric contributions and covers only one hemisphere.

To cover the full azimuthal range, set `lookUpTables.skyViewLut.uniformParameterizationConfig`.  
This allows multiple light directions to be fully represented but comes at the cost of reduced angular resolution for individual light sources.

```js
const config = {
    ...
    lights: {
        useMoon: true,
    },
    lookUpTables: {
        skyViewLut: {
            uniformParameterizationConfig: {},
        },
    },
    ...
}
```

Check out this [demo with two suns](https://jolifantobambla.github.io/webgpu-sky-atmosphere/demo/?two_suns&uniform_sky_view) for an example.

#### Sun disk rendering

A simple implementation for rendering a sun and a moon disk is provided.
Use the `Uniforms` to adjust the sun disk's appearance:

```js
const uniforms = {
  sun: {
    ...
    diskAngularDiameter: 0.0095, // angular diameter in radians
    diskLuminanceScale: 20.0, // make the disk appear brighter
  },
  ...
};
```

The provided implementation can be disabled using the `lights` property of the config:

```js
const config = {
    ...
    lights: {
        renderSunDisk: false,
        renderMoonDisk: false,
    },
    ...
}
```

#### Integrating shadows

User-controlled shadowing can be integrated into a `SkyAtmosphereLutRenderer` by injecting bind groups and WGSL code into the sky / atmosphere rendering pipelines and shaders via the `shadow` property of the `SkyAtmosphereConfig` used to create the renderer.

Most importantly, the WGSL code provided by the config must implement the following function:

```wgsl
fn get_shadow(world_space_position: vec3<f32>, light_index: u32) -> f32
```

Internally, `get_shadow` will be called for each ray marching sample.
It should return a floating point value in the range [0, 1], where 1 implies that the world space position given (`world_space_position`) is not in shadow.
The `light_index` parameter refers to the index of the atmosphere light, where `0` refers to the sun and `1` refers to the moon.
Additionally, the WGSL code should also define all external bind groups required by the shadowing implementation.

Except for the `get_shadow` interface, the `SkyAtmosphereLutRenderer`s are agnostic to the shadowing technique used.

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

It is likely that some or even all uniforms used by a `SkyAtmosphereLutRenderer` are already available on the GPU in some other buffer(s) in your engine.
To replace the `SkyAtmosphereLutRenderer`'s internal uniform buffer by one or more user-controlled uniform buffers, configure the renderer to inject external bind groups and WGSL code, similar to how shadows are integrated into the renderer:

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

### Lookup tables

Both sky rendering methods depend on a couple of cheap-to-compute (see [demo with performance metrics (requires WebGPU and 'timestamp-query' support)](https://jolifantobambla.github.io/webgpu-sky-atmosphere/demo/?timestamp_query)) lookup tables:

 * Transmittance LUT: stores the colored transmittance towards the top of the atmosphere parameterized by the sample height and direction
 * Multiple Scattering LUT: stores the contribution of multiple scattering parameterized by the sample height and sun direction
 * Sky View LUT: stores the view of the distant sky for the current camera position parameterized by latitude and longitude
 * Aerial Perspective LUT: stores the aerial perspective for the current camera frustum as a volume texture (rgb-colored luminance reaching the camera from the froxel's center and grayscale transmittance from the camera to the froxel's center)

To change the format or size of any of the lookup tables, use the `lookUpTables` property of the config, e.g.:

```js
const config = {
  lookUpTables: {
    transmittanceLut: {
      format: 'rgba32float', // note that the use of 'rgba32float' requires the device-feature 'float32-filterable' to be enabled
    },
    aerialPerspectiveLut: {
      size: [64, 64, 32],
    },
  },
  ...
};
```

For more information on the individual options, please refer to the [documentation](https://jolifantobambla.github.io/webgpu-sky-atmosphere/interfaces/SkyAtmosphereLutConfig).

The transmittance and the multiple scattering lookup table are constant for a given atmosphere. This is why they are rendered during the `SkyAtmosphereLutRenderer`'s constructor by default and re-rendered by `renderLutsAndSky` / `renderLuts` only if the optional `atmopshere` parameter is set.
To re-render the two lookup tables outside of these scenarios, call:

```js
skyRenderer.renderConstantLuts(
  computePassEncoder,
  // this is optional
  // if this is undefined, the internal atmosphere parameters will not be updated but the lookup tables will still be rendered
  atmosphere,
);
```

While the constant lookup tables are used by both sky rendering methods, the sky view and aerial perspective lookup tables are not used by the full-resolution ray marching method.
Since they are view dependent, they are re-rendered whenever new `Uniforms` are passed to `renderLutsAndSky` / `renderLuts` and the lookup table based sky rendering technique is chosen.
To only update these two lookup tables, call:

```js
skyRenderer.renderDynamicLuts(
  computePassEncoder,
  // passing the uniforms is optional
  // if this is undefined, the internal uniform buffer will not be updated
  uniforms,
);
```

Alternatively, each lookup table can be rendered individually.
See the [documentation](https://jolifantobambla.github.io/webgpu-sky-atmosphere/classes/SkyAtmosphereLutRenderer) for more details.


## Integrating this library into a renderer

This library makes a couple of assumptions about the render engine that uses it.
For a `SkyAtmosphereLutRenderer` to produce nice results, the render engine should...

 * ...use some kind of tone-mapping operator
 * ...use either dithering or temporal anti-aliasing to get rid of banding artefacts introduced by the use of low-resolution lookup tables
 * ...use a bloom filter to give the sun disk a nicer look
 * ...use temporal anti-aliasing to get rid of the noise introduced by randomizing ray offsets for full-resolution ray marching

The [demo](https://jolifantobambla.github.io/webgpu-sky-atmosphere/demo/) uses a hard-coded tonemapping operator and gradient noise-based dithering to address some of these issues.


## Contributions

Contributions are very welcome. If you find a bug or think some important functionality is missing, please file an issue [here](https://github.com/JolifantoBambla/webgpu-sky-atmosphere/issues). If want to help out yourself, feel free to submit a pull request [here](https://github.com/JolifantoBambla/webgpu-sky-atmosphere/pulls).


## Acknowledgements

This library is originally a WebGPU port of Sébastien Hillaire's [demo implementation](https://github.com/sebh/UnrealEngineSkyAtmosphere) for his paper [A Scalable and Production Ready
Sky and Atmosphere Rendering Technique](https://sebh.github.io/publications/egsr2020.pdf).
The original demo was released under the MIT licence by Epic Games, Inc.
