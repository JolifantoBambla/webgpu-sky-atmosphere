import { makeEarthAtmosphere } from '../dist/1.x/webgpu-sky-atmosphere.module.min.js';
import { Pane } from 'https://cdn.jsdelivr.net/npm/tweakpane@4.0.3/dist/tweakpane.min.js';

export function makeUi(atmosphere, camera) {
    const params = {
        debugViews: {
            showTransmittanceLut: false,
    
            showMultiScatteringLut: false,
            multiScatteringLutFactor: 50,
            
            showSkyViewLut: false,
            skyViewLutFactor: 50,
            
            showAerialPerspectiveLut: false,
            aerialPerspectiveLutFactor: 50,
            aerialPerspectiveSlice: 0,
        },
        renderSettings: {
            sun: {
                illuminance: {r: 1.0, g: 1.0, b: 1.0},
                illuminanceFactor: 1.0,
                direction: {x: 0.0, y: 1.0},
                diskDiameter: 2.3,
                diskIlluminance: 65.0,
            },
            rayMarchingMinSpp: 14,
            rayMarchingMaxSpp: 30,
            rayMarch: false,
            compute: true,
            viewHeight: 1.0,
            inMeters: false,
        },
        atmosphereHelper: {
            bottomRadius: 6360.0,
            height: 100.0,
            rayleigh: {
                scaleHeight: 8.0,
                // per 100 m
                scattering: {
                    r: 0.05802,
                    g: 0.13558,
                    b: 0.33100,
                },
            },
            mie: {
                scaleHeight: 1.2,
                phaseG: 0.8,
                // per 10 m
                scattering: {
                    r: 0.3996,
                    g: 0.3996,
                    b: 0.3996,
                },
                // per 10 m
                extinction: {
                    r: 0.4440,
                    g: 0.4440,
                    b: 0.4440,
                },
            },
            absorption: {
                // per 10 m
                extinction: {
                    r: 0.0650,
                    g: 0.1881,
                    b: 0.0085,
                },
            },
            groundAlbedo: {
                r: 0.4,
                g: 0.4,
                b: 0.4,
            },
        },
    };
    params.scaleFromKilometers = _ => params.renderSettings.inMeters ? 1000.0 : 1.0;

    params.atmosphere = atmosphere || makeEarthAtmosphere(params.scaleFromKilometers());

    const pane = new Pane({
        title: 'WebGPU Sky / Atmosphere',
        expanded: true,
        container: document.getElementById('ui'),
    });
    pane.addBinding({
        info: `WASD: move horizontally
Arrow Up / Down: move vertically
Space (hold): move faster
Mouse (click on canvas): look around
Escape: exit pointer lock on canvas`,
    }, 'info', {
        label: null,
        readonly: true,
        multiline: true,
        rows: 5,
    });

    const renderSettingsFolder = pane.addFolder({
        title: 'Render settings',
        expanded: true,
    });
    renderSettingsFolder.addBinding(params.renderSettings.sun, 'illuminance', {color: {type: 'float'}, label: 'Sun illuminance (outer space)'});
    renderSettingsFolder.addBinding(params.renderSettings.sun, 'illuminanceFactor', {min: 0.1, max: 10.0, step: 0.1, label: 'Sun illum. scale'});
    renderSettingsFolder.addBinding(params.renderSettings.sun, 'direction', {picker: 'inline', expanded: true, y: {inverted: true, min: -1.0, max: 1.0}, x: {min: -1.0, max: 1.0}, label: 'Sun direction'});
    renderSettingsFolder.addBinding(params.renderSettings.sun, 'diskDiameter', {min: 0.1, max: 100.0, step: 0.1, label: 'Sun disk ang. diameter (deg)'});
    renderSettingsFolder.addBinding(params.renderSettings.sun, 'diskIlluminance', {min: 1.0, max: 100.0, step: 1, label: 'Sun disk luminance scale'});
    const rayMarchMinSlider = renderSettingsFolder.addBinding(params.renderSettings, 'rayMarchingMinSpp', {min: 14, max: 99, step: 1, label: 'Min. SPP'});
    const rayMarchMaxSlider = renderSettingsFolder.addBinding(params.renderSettings, 'rayMarchingMaxSpp', {min: 15, max: 100, step: 1, label: 'Max. SPP'});
    rayMarchMaxSlider.on('change', e => {
            params.renderSettings.rayMarchingMinSpp = Math.min(params.renderSettings.rayMarchingMinSpp, e.value - 1);
            rayMarchMinSlider.refresh();
        });
    rayMarchMinSlider.on('change', e => {
            params.renderSettings.rayMarchingMaxSpp = Math.max(params.renderSettings.rayMarchingMaxSpp, e.value + 1);
            rayMarchMaxSlider.refresh();
        });
    
    renderSettingsFolder.addBinding(params.renderSettings, 'rayMarch', {label: 'Force ray marching'});
    renderSettingsFolder.addBinding(params.renderSettings, 'compute', {label: 'Use compute'});
    renderSettingsFolder.addBinding(params.renderSettings, 'inMeters', {label: '1 = 1m'})
        .on('change', e => {
            const scale = e.value ? 1000.0 : 1 / 1000.0;

            camera.height = Math.max(camera.position[1], e.value ? 25 : 1);
            camera.maxSpeed = e.value ? 1.0 : 0.1;

            params.atmosphere = {
                center: params.atmosphere.center.map(c => c * scale),
                bottomRadius: params.atmosphere.bottomRadius * scale,
                height: params.atmosphere.height * scale,
                rayleigh: {
                    densityExpScale: params.atmosphere.rayleigh.densityExpScale / scale,
                    scattering: params.atmosphere.rayleigh.scattering.map(c => c / scale),
                },
                mie: {
                    densityExpScale: params.atmosphere.mie.densityExpScale / scale,
                    scattering: params.atmosphere.mie.scattering.map(c => c / scale),
                    extinction: params.atmosphere.mie.extinction.map(c => c / scale),
                    phaseG: params.atmosphere.mie.phaseG * scale,
                },
                absorption: {
                    layer0: {
                        height: params.atmosphere.absorption.layer0.height * scale,
                        constantTerm: params.atmosphere.absorption.layer0.constantTerm,
                        linearTerm: params.atmosphere.absorption.layer0.linearTerm / scale,
                    },
                    layer1: {
                        constantTerm: params.atmosphere.absorption.layer1.constantTerm,
                        linearTerm: params.atmosphere.absorption.layer1.linearTerm / scale,
                    },
                    extinction: params.atmosphere.absorption.extinction.map(c => c / scale),
                },
                groundAlbedo: params.atmosphere.groundAlbedo,
                multipleScatteringFactor: params.atmosphere.multipleScatteringFactor,
            };
        });

    const atmosphereFolder = pane.addFolder({
        title: 'Atmosphere',
        expanded: true,
    });
    atmosphereFolder.addBinding(params.atmosphereHelper, 'bottomRadius', {min: 100.0, max: 10000.0, step: 10.0, label: 'ground radius (in km)'})
        .on('change', e => {
            params.atmosphere.bottomRadius = e.value * params.scaleFromKilometers();
        });
    atmosphereFolder.addBinding(params.atmosphereHelper, 'height', {min: 10.0, max: 500.0, step: 1.0, label: 'height (in km)'})
        .on('change', e => {
            params.atmosphere.height = e.value * params.scaleFromKilometers();
        });
    atmosphereFolder.addBinding(params.atmosphere, 'multipleScatteringFactor', {min: 0.0, max: 1.0, step: 0.1, label: 'Multi-scattering factor'});
    atmosphereFolder.addBinding(params.atmosphereHelper, 'groundAlbedo', {color: {type: 'float'}, label: 'Ground albedo'})
        .on('change', e => {
            params.atmosphere.groundAlbedo = [e.value.r, e.value.g, e.value.b];
        });

    const rayleighFolder = atmosphereFolder.addFolder({
        title: 'Rayleigh',
        expanded: true,
    });
    rayleighFolder.addBinding(params.atmosphereHelper.rayleigh, 'scaleHeight', {min: 0.0, max: 10.0, step: 0.1, label: 'scale height (in km)'})
        .on('change', e => {
            params.atmosphere.rayleigh.densityExpScale = -1.0 / (e.value * params.scaleFromKilometers());
        });
    rayleighFolder.addBinding(params.atmosphereHelper.rayleigh, 'scattering', {color: {type: 'float'}, label: 'scattering (per 100 m)'})
        .on('change', e => {
            params.atmosphere.rayleigh.scattering = [e.value.r, e.value.g, e.value.b].map(c => c / (10.0 * params.scaleFromKilometers()));
        });

    const mieFolder = atmosphereFolder.addFolder({
        title: 'Mie',
        expanded: true,
    });
    mieFolder.addBinding(params.atmosphereHelper.mie, 'scaleHeight', {min: 0.0, max: 10.0, step: 0.1, label: 'scale height (in km)'})
        .on('change', e => {
            params.atmosphere.mie.densityExpScale = -1.0 / (e.value * params.scaleFromKilometers());
        });
    mieFolder.addBinding(params.atmosphereHelper.mie, 'scattering', {color: {type: 'float'}, label: 'scattering (per 10 m)'})
        .on('change', e => {
            params.atmosphere.mie.scattering = [e.value.r, e.value.g, e.value.b].map(c => c / (100.0 * params.scaleFromKilometers()));
        });
    mieFolder.addBinding(params.atmosphereHelper.mie, 'extinction', {color: {type: 'float'}, label: 'extinction (per 10 m)'})
        .on('change', e => {
            params.atmosphere.mie.extinction = [e.value.r, e.value.g, e.value.b].map(c => c / (100.0 * params.scaleFromKilometers()));
        });            
    mieFolder.addBinding(params.atmosphereHelper.mie, 'phaseG', {min: 0.0, max: 1.0, step: 0.1, label: 'phase g'})
        .on('change', e => {
            params.atmosphere.mie.phaseG = e.value * params.scaleFromKilometers();
        });

    const absorptionFolder = atmosphereFolder.addFolder({
        title: 'Ozone',
        expanded: true,
    });
    absorptionFolder.addBinding(params.atmosphereHelper.absorption, 'extinction', {color: {type: 'float'}, label: 'extinction (per 10 m)'})
        .on('change', e => {
            params.atmosphere.absorption.extinction = [e.value.r, e.value.g, e.value.b].map(c => c / (100.0 * params.scaleFromKilometers()));
        });

    const debugViewFolder = pane.addFolder({
        title: 'Debug views',
        expanded: false,
    });
    debugViewFolder.addBinding(params.debugViews, 'showTransmittanceLut', {label: 'Show transmittance LUT'});

    debugViewFolder.addBinding(params.debugViews, 'showMultiScatteringLut', {label: 'Show multi. scat. LUT'});
    debugViewFolder.addBinding(params.debugViews, 'multiScatteringLutFactor', {min: 1, max: 100, step: 1, label: 'Multi. scat. scale'});
    
    debugViewFolder.addBinding(params.debugViews, 'showSkyViewLut', {label: 'Show sky view LUT'});
    debugViewFolder.addBinding(params.debugViews, 'skyViewLutFactor', {min: 1, max: 100, step: 1, label: 'Sky view scale'});
    
    debugViewFolder.addBinding(params.debugViews, 'showAerialPerspectiveLut', {label: 'Show aerial persp. LUT'});
    debugViewFolder.addBinding(params.debugViews, 'aerialPerspectiveLutFactor', {min: 1, max: 100, step: 1, label: 'Aerial persp. scale'});
    debugViewFolder.addBinding(params.debugViews, 'aerialPerspectiveSlice', {min: 0, max: 31, step: 1, label: 'Aerial persp. slice'});

    return params;
}
