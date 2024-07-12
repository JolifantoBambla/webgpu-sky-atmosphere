import { makeEarthAtmosphere } from '../dist/1.x/webgpu-sky-atmosphere.module.min.js';
import { Pane } from 'https://cdn.jsdelivr.net/npm/tweakpane@4.0.3/dist/tweakpane.min.js';

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
    config: {
        camera: {
            position: [0.0, 1.0, 0.0],
            inverseView: Array(16).fill(0.0),
            inverseProjection: Array(16).fill(0.0),
        },
        sun: {
            illuminance: [1.0, 1.0, 1.0],
            direction: [0.0, 1.0, 0.0],
        },
        screenResolution: [1920, 1080],
        rayMarchMinSPP: 30,
        rayMarchMaxSPP: 31,
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
    },
    atmosphere: makeEarthAtmosphere([0.0, -makeEarthAtmosphere().bottomRadius, 0.0]),
    atmosphereHelper: {
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
    },
};

export function makeUi() {
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
    renderSettingsFolder.addBinding(params.config, 'rayMarchMinSPP', {min: 14, max: 100, step: 1, label: 'Min. SPP'});
    renderSettingsFolder.addBinding(params.renderSettings, 'rayMarch', {label: 'Force ray marching'});

    const atmosphereFolder = pane.addFolder({
        title: 'Atmosphere',
        expanded: true,
    });
    atmosphereFolder.addBinding(params.atmosphere, 'bottomRadius', {min: 100.0, max: 10000.0, step: 10.0, label: 'ground radius'});
    atmosphereFolder.addBinding(params.atmosphere, 'height', {min: 10.0, max: 500.0, step: 1.0, label: 'height'});
    //atmosphereFolder.addBinding(params.atmosphere, 'groundAlbedo', )

    const rayleighFolder = atmosphereFolder.addFolder({
        title: 'Rayleigh',
        expanded: true,
    });
    rayleighFolder.addBinding(params.atmosphereHelper.rayleigh, 'scaleHeight', {min: 0.0, max: 10.0, step: 0.1, label: 'scale height'})
        .on('change', e => {
            params.atmosphere.rayleigh.densityExpScale = -1.0 / e.value;
        });
    rayleighFolder.addBinding(params.atmosphereHelper.rayleigh, 'scattering', {color: {type: 'float'}, label: 'scattering (per 100 m)'})
        .on('change', e => {
            params.atmosphere.rayleigh.scattering = [e.value.r, e.value.g, e.value.b].map(c => c / 10.0);
        });

    const mieFolder = atmosphereFolder.addFolder({
        title: 'Mie',
        expanded: true,
    });
    mieFolder.addBinding(params.atmosphereHelper.mie, 'scaleHeight', {min: 0.0, max: 10.0, step: 0.1, label: 'scale height'})
        .on('change', e => {
            params.atmosphere.mie.densityExpScale = -1.0 / e.value;
        });
    mieFolder.addBinding(params.atmosphereHelper.mie, 'scattering', {color: {type: 'float'}, label: 'scattering (per 10 m)'})
        .on('change', e => {
            params.atmosphere.mie.scattering = [e.value.r, e.value.g, e.value.b].map(c => c / 100.0);
        });
    mieFolder.addBinding(params.atmosphereHelper.mie, 'extinction', {color: {type: 'float'}, label: 'extinction (per 10 m)'})
        .on('change', e => {
            params.atmosphere.mie.extinction = [e.value.r, e.value.g, e.value.b].map(c => c / 100.0);
        });            
    mieFolder.addBinding(params.atmosphere.mie, 'phaseG', {min: 0.0, max: 1.0, step: 0.1, label: 'phase g'});

    const absorptionFolder = atmosphereFolder.addFolder({
        title: 'Ozone',
        expanded: true,
    });
    absorptionFolder.addBinding(params.atmosphereHelper.absorption, 'extinction', {color: {type: 'float'}, label: 'extinction (per 10 m)'})
        .on('change', e => {
            params.atmosphere.absorption.extinction = [e.value.r, e.value.g, e.value.b].map(c => c / 100.0);
        });

    return params;
}
