import { makeEarthAtmosphere } from '../dist/1.x/webgpu-sky-atmosphere.module.min.js';
import { Pane } from 'https://cdn.jsdelivr.net/npm/tweakpane@4.0.3/dist/tweakpane.min.js';

export function makeUi(atmosphere, camera, scaleFromKilometers = 1.0) {
    const params = {
        debugViews: {
            showTransmittanceLut: true,
    
            showMultiScatteringLut: true,
            multiScatteringLutFactor: 50,
            
            showSkyViewLut: true,
            skyViewLutFactor: 50,
            
            showAerialPerspectiveLut: true,
            aerialPerspectiveLutFactor: 50,
            aerialPerspectiveSlice: 0,
        },
        renderSettings: {
            sun: {
                illuminance: {r: 1.0, g: 1.0, b: 1.0},
                illuminanceFactor: 1.0,
                direction: {x: 0.0, y: 1.0},
                diskDiameter: 0.545,
                diskIlluminance: 120000.0,
            },
            rayMarchingMinSpp: 14,
            rayMarchingMaxSpp: 30,
            rayMarch: false,
            compute: true,
            viewHeight: 1.0,
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

    params.atmosphere = atmosphere || makeEarthAtmosphere(scaleFromKilometers);

    const pane = new Pane({
        title: 'WebGPU Sky / Atmosphere',
        expanded: true,
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

    const renderSettingsFolder = pane.addFolder({
        title: 'Render settings',
        expanded: true,
    });
    renderSettingsFolder.addBinding(params.renderSettings.sun, 'illuminance', {color: {type: 'float'}, label: 'Sun illuminance'});
    renderSettingsFolder.addBinding(params.renderSettings.sun, 'illuminanceFactor', {min: 0.1, max: 10.0, step: 0.1, label: 'Sun illum. scale'});
    renderSettingsFolder.addBinding(params.renderSettings.sun, 'direction', {picker: 'inline', expanded: true, y: {inverted: true, min: -1.0, max: 1.0}, x: {min: -1.0, max: 1.0}, label: 'Sun direction'});
    renderSettingsFolder.addBinding(params.renderSettings.sun, 'diskDiameter', {min: 0.1, max: 100.0, step: 0.1, label: 'Sun disk ang. diameter (deg)'});
    renderSettingsFolder.addBinding(params.renderSettings.sun, 'diskIlluminance', {min: 1.0, max: 120000.0, step: 10, label: 'Sun disk illuminance (at zenith)'});
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
    renderSettingsFolder.addBinding(params.renderSettings, 'viewHeight', {min: 1, max: 110000.0, label: 'View height (% of atmosphere height)'})
        .on('change', e => {
            camera.height = (e.value / 100.0) * params.atmosphere.height;
        });

    const atmosphereFolder = pane.addFolder({
        title: 'Atmosphere',
        expanded: true,
    });
    atmosphereFolder.addBinding(params.atmosphereHelper, 'bottomRadius', {min: 100.0, max: 10000.0, step: 10.0, label: 'ground radius (in km)'})
        .on('change', e => {
            params.atmosphere.bottomRadius = e.value * scaleFromKilometers;
        });
    atmosphereFolder.addBinding(params.atmosphereHelper, 'height', {min: 10.0, max: 500.0, step: 1.0, label: 'height (in km)'})
        .on('change', e => {
            params.atmosphere.height = e.value * scaleFromKilometers;
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
            params.atmosphere.rayleigh.densityExpScale = -1.0 / (e.value * scaleFromKilometers);
        });
    rayleighFolder.addBinding(params.atmosphereHelper.rayleigh, 'scattering', {color: {type: 'float'}, label: 'scattering (per 100 m)'})
        .on('change', e => {
            params.atmosphere.rayleigh.scattering = [e.value.r, e.value.g, e.value.b].map(c => c / (10.0 * scaleFromKilometers));
        });

    const mieFolder = atmosphereFolder.addFolder({
        title: 'Mie',
        expanded: true,
    });
    mieFolder.addBinding(params.atmosphereHelper.mie, 'scaleHeight', {min: 0.0, max: 10.0, step: 0.1, label: 'scale height (in km)'})
        .on('change', e => {
            params.atmosphere.mie.densityExpScale = -1.0 / (e.value * scaleFromKilometers);
        });
    mieFolder.addBinding(params.atmosphereHelper.mie, 'scattering', {color: {type: 'float'}, label: 'scattering (per 10 m)'})
        .on('change', e => {
            params.atmosphere.mie.scattering = [e.value.r, e.value.g, e.value.b].map(c => c / (100.0 * scaleFromKilometers));
        });
    mieFolder.addBinding(params.atmosphereHelper.mie, 'extinction', {color: {type: 'float'}, label: 'extinction (per 10 m)'})
        .on('change', e => {
            params.atmosphere.mie.extinction = [e.value.r, e.value.g, e.value.b].map(c => c / (100.0 * scaleFromKilometers));
        });            
    mieFolder.addBinding(params.atmosphereHelper.mie, 'phaseG', {min: 0.0, max: 1.0, step: 0.1, label: 'phase g'})
        .on('change', e => {
            params.atmosphere.mie.phaseG = e.value * scaleFromKilometers;
        });

    const absorptionFolder = atmosphereFolder.addFolder({
        title: 'Ozone',
        expanded: true,
    });
    absorptionFolder.addBinding(params.atmosphereHelper.absorption, 'extinction', {color: {type: 'float'}, label: 'extinction (per 10 m)'})
        .on('change', e => {
            params.atmosphere.absorption.extinction = [e.value.r, e.value.g, e.value.b].map(c => c / (100.0 * scaleFromKilometers));
        });

    return params;
}
