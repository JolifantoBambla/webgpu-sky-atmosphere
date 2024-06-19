import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import fs from 'fs';

const pkg = JSON.parse(fs.readFileSync('package.json', {encoding: 'utf8'}));
const banner = `/* webgpu-sky-atmosphere@${pkg.version}, license MIT */`;
const major = pkg.version.split('.')[0];
const dist = `dist/${major}.x`;

const wgslPlugin = (options = {}) => {
    return {
        name: 'wgsl',
        load(id) {
            if (id.toLowerCase().endsWith(`.wgsl`)) {
                return `export default ${JSON.stringify(fs.readFileSync(id, 'utf-8'))};`
            } else {
                return null;
            }
        }
    }
};

const plugins = [
    nodeResolve(),
    typescript({ tsconfig: './tsconfig.json' }),
    wgslPlugin(),
];
const shared = {
    watch: {
        clearScreen: false,
    },
};

export default [
    {
        input: 'src/webgpu-sky-atmosphere.ts',
        output: [
            {
                file: `${dist}/webgpu-sky-atmosphere.module.js`,
                format: 'esm',
                sourcemap: true,
                freeze: false,
                banner,
            },
        ],
        plugins,
        ...shared,
    },
    {
        input: 'src/webgpu-sky-atmosphere.ts',
        output: [
            {
                file: `${dist}/webgpu-sky-atmosphere.module.min.js`,
                format: 'esm',
                sourcemap: true,
                freeze: false,
                banner,
            },
        ],
        plugins: [
            ...plugins,
            terser(),
        ],
        ...shared,
    },
    {
        input: 'src/webgpu-sky-atmosphere.ts',
        output: [
            {
                name: 'webgpuSkyAtmosphere',
                file: `${dist}/webgpu-sky-atmosphere.js`,
                format: 'umd',
                sourcemap: true,
                freeze: false,
                banner,
            },
        ],
        plugins,
        ...shared,
    },
    {
        input: 'src/webgpu-sky-atmosphere.ts',
        output: [
            {
                name: 'webgpuSkyAtmosphere',
                file: `${dist}/webgpu-sky-atmosphere.min.js`,
                format: 'umd',
                sourcemap: true,
                freeze: false,
                banner,
            },
        ],
        plugins: [
            ...plugins,
            terser(),
        ],
        ...shared,
    },
];
