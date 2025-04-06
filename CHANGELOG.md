# Changelog

## [Unreleased]

## [1.2.0] - 2025-04-06

### Added

 - Add optional sky view LUT parameterization using a uniform longitude mapping across the full azimuthal range ([0,τ]).
 - Add demo for two suns.
 - Add azimuth sliders for suns in demo.

### Fixed

 - Fix typos in installation steps and docs.
 - Fix possible NaNs in sky view LUT parameterization.

## [1.1.0] - 2024-09-26

### Added

 - Add the Mie phase approximation by [Jendersie and d'Eon](https://research.nvidia.com/labs/rtr/approximate-mie/) as an alternative to Cornette-Shanks.
 - Add demo for new Mie phase approximation.

### Changed

 - Specify component types for all vector in shaders.

### Fixed

 - Fix vulnerabilities in dev dependencies (rollup, micromatch).
