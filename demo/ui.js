import { makeEarthAtmosphere } from '../dist/1.x/webgpu-sky-atmosphere.module.min.js';
import { Pane } from 'https://cdn.jsdelivr.net/npm/tweakpane@4.0.3/dist/tweakpane.min.js';

export function makeUi(atmosphere, camera, showPerformanceGraph) {
    const cameraPositionKilometers = [0, 1, 100];
    const cameraPositionMeters = [0, 50, 100000];

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
            coloredTransmittance: false,
            rayMarchDistantSky: true,
            compute: true,
            viewHeight: 1.0,
            inMeters: false,
            scale: '1 = 1km',
            sceneAffectedByScale: true,
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
                phaseParam: 5.0,
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
        monitoring: {
            transmittance: 0,
            multiScattering: 0,
            skyView: 0,
            aerialPerspective: 0,
            sky: 0,
            constant: 0,
            dynamic: 0,
            luts: 0,
            total: 0,
        },
    };
    params.scaleFromKilometers = _ => params.renderSettings.inMeters ? 1000.0 : 1.0;

    params.atmosphere = atmosphere || makeEarthAtmosphere();

    const pane = new Pane({
        title: 'WebGPU Sky / Atmosphere',
        expanded: true,
        container: document.getElementById('ui'),
    });
    pane.addBinding({
        info: `WASD: move horizontally
Arrow Up / Down: move vertically
Space (hold): move faster
Mouse (click on canvas first): look around
Escape: exit pointer lock on canvas`,
    }, 'info', {
        label: null,
        readonly: true,
        multiline: true,
        rows: 5,
    });

    if (showPerformanceGraph) {
        const performanceFolder = pane.addFolder({
            title: 'Performance',
            expanded: true,
        });
        performanceFolder.addBinding(params.monitoring, 'transmittance', {
            label: 'Transmittance LUT ([0, 1] ms)',
            readonly: true,
            view: 'graph',
            min: 0,
            max: 1,
        });
        performanceFolder.addBinding(params.monitoring, 'transmittance', {
            label: '',
            readonly: true,
        });
        performanceFolder.addBinding(params.monitoring, 'multiScattering', {
            label: 'Multiple Scattering LUT ([0, 1] ms)',
            readonly: true,
            view: 'graph',
            min: 0,
            max: 1,
        });
        performanceFolder.addBinding(params.monitoring, 'multiScattering', {
            label: '',
            readonly: true,
        });
        performanceFolder.addBinding(params.monitoring, 'skyView', {
            label: 'Sky View LUT ([0, 1] ms)',
            readonly: true,
            view: 'graph',
            min: 0,
            max: 1,
        });
        performanceFolder.addBinding(params.monitoring, 'skyView', {
            label: '',
            readonly: true,
        });
        performanceFolder.addBinding(params.monitoring, 'aerialPerspective', {
            label: 'Aerial Perspective LUT ([0, 1] ms)',
            readonly: true,
            view: 'graph',
            min: 0,
            max: 1,
        });
        performanceFolder.addBinding(params.monitoring, 'aerialPerspective', {
            label: '',
            readonly: true,
        });
        performanceFolder.addBinding(params.monitoring, 'sky', {
            label: 'Sky  ([0, 5] ms)',
            readonly: true,
            view: 'graph',
            min: 0,
            max: 5,
        });
        performanceFolder.addBinding(params.monitoring, 'sky', {
            label: '',
            readonly: true,
        });
        performanceFolder.addBlade({view: 'separator'});
        performanceFolder.addBinding(params.monitoring, 'constant', {
            label: 'Constant LUTs ([0, 1] ms)',
            readonly: true,
            view: 'graph',
            min: 0,
            max: 1,
        });
        performanceFolder.addBinding(params.monitoring, 'constant', {
            label: '',
            readonly: true,
        });
        performanceFolder.addBinding(params.monitoring, 'dynamic', {
            label: 'Dynamic LUTs ([0, 1] ms)',
            readonly: true,
            view: 'graph',
            min: 0,
            max: 1,
        });
        performanceFolder.addBinding(params.monitoring, 'dynamic', {
            label: '',
            readonly: true,
        });
        performanceFolder.addBinding(params.monitoring, 'luts', {
            label: 'LUTs ([0, 1] ms)',
            readonly: true,
            view: 'graph',
            min: 0,
            max: 1,
        });
        performanceFolder.addBinding(params.monitoring, 'luts', {
            label: '',
            readonly: true,
        });
        performanceFolder.addBlade({view: 'separator'});
        performanceFolder.addBinding(params.monitoring, 'total', {
            label: 'Total  ([0, 16.6] ms)',
            readonly: true,
            view: 'graph',
            min: 0,
            max: 16.6,
        });
        performanceFolder.addBinding(params.monitoring, 'total', {
            label: '',
            readonly: true,
        });

    }

    const renderSettingsFolder = pane.addFolder({
        title: 'Render settings',
        expanded: true,
    });
    renderSettingsFolder.addBinding(params.renderSettings, 'rayMarch', {label: 'Full-resolution ray marching'});
    renderSettingsFolder.addBinding(params.renderSettings, 'coloredTransmittance', {label: 'Colored transmittance (ray march only)'});
    renderSettingsFolder.addBinding(params.renderSettings, 'rayMarchDistantSky', {label: 'Raymarch distant sky (ray march only)'});
    renderSettingsFolder.addBinding(params.renderSettings, 'compute', {label: 'Use compute'});
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

    renderSettingsFolder.addBinding(params.renderSettings, 'scale', {label: 'Scale', options: { '1 = 1km': '1 = 1km', '1 = 1m': '1 = 1m', }})
        .on('change', e => {
            const old = params.renderSettings.inMeters;
            params.renderSettings.inMeters = e.value === '1 = 1m';
            
            if (old === params.renderSettings.inMeters) {
                return;
            }

            camera.position = params.renderSettings.inMeters ? cameraPositionMeters : cameraPositionKilometers;
            //camera.maxSpeed = params.renderSettings.inMeters ? 1.0 : 0.1;
        });

    const sunFolder = pane.addFolder({
        title: 'Sun',
        expanded: !showPerformanceGraph,
    });
    sunFolder.addBinding(params.renderSettings.sun, 'illuminance', {color: {type: 'float'}, label: 'Illuminance (outer space)'});
    sunFolder.addBinding(params.renderSettings.sun, 'illuminanceFactor', {min: 0.1, max: 10.0, step: 0.1, label: 'Illuminance scale'});
    sunFolder.addBinding(params.renderSettings.sun, 'direction', {picker: 'inline', expanded: true, y: {inverted: true, min: -1.0, max: 1.0}, x: {min: -1.0, max: 1.0}, label: 'Direction'});
    sunFolder.addBinding(params.renderSettings.sun, 'diskDiameter', {min: 0.1, max: 100.0, step: 0.1, label: 'Sun disk angular diameter (deg)'});
    sunFolder.addBinding(params.renderSettings.sun, 'diskIlluminance', {min: 1.0, max: 100.0, step: 1, label: 'Sun disk luminance scale'});
    

    const atmosphereFolder = pane.addFolder({
        title: 'Atmosphere',
        expanded: !showPerformanceGraph,
    });
    atmosphereFolder.addBinding(params.atmosphere, 'bottomRadius', {min: 100.0, max: params.atmosphere.bottomRadius, step: 10.0, label: 'ground radius (in km)'});
    atmosphereFolder.addBinding(params.atmosphere, 'height', {min: 10.0, max: 500.0, step: 1.0, label: 'height (in km)'});
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
    mieFolder.addBinding(params.atmosphereHelper.mie, 'scaleHeight', {min: 0.0, max: 10.0, step: 0.1, label: 'scale height (in km)'})
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
    mieFolder.addBinding(params.atmosphere.mie, 'phaseParam', {min: 2.0, max: 20.0, step: 0.1, label: 'Droplet diameter'});

    const absorptionFolder = atmosphereFolder.addFolder({
        title: 'Ozone',
        expanded: true,
    });
    absorptionFolder.addBinding(params.atmosphereHelper.absorption, 'extinction', {color: {type: 'float'}, label: 'extinction (per 10 m)'})
        .on('change', e => {
            params.atmosphere.absorption.extinction = [e.value.r, e.value.g, e.value.b].map(c => c / 100.0);
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
