// ioBroker eslint template configuration file for js and ts files
// Please note that esm or react based modules need additional modules loaded.
import config from '@iobroker/eslint-config';

export default [
    ...config,
    {
        // specify files to exclude from linting here
        ignores: [
            '.dev-server/',
            '.vscode/',
            '*.test.js',
            'test/**/*.js',
            '*.config.mjs',
            // Bare 'build'/'dist' only match a top-level directory with flat-config's glob
            // semantics (unlike .gitignore) - the **/ prefix also covers nested build output.
            '**/build/**',
            '**/dist/**',
            'admin/words.js',
            'admin/admin.d.ts',
            'admin/blockly.js',
            '**/adapter-config.d.ts',
            'widgets/**/*.js',
        ],
    },
    {
        // you may disable some 'jsdoc' warnings - but using jsdoc is highly recommended
        // as this improves maintainability. jsdoc warnings will not block build process.
        rules: {
            // 'jsdoc/require-jsdoc': 'off',
            // 'jsdoc/require-param': 'off',
            // 'jsdoc/require-param-description': 'off',
            // 'jsdoc/require-returns-description': 'off',
            // 'jsdoc/require-returns-check': 'off',
        },
    },
    {
        // The diagram page runs in the browser and is plain ES5 so that it needs no build step
        files: ['www/**/*.js'],
        languageOptions: {
            sourceType: 'script',
            globals: {
                document: 'readonly',
                fetch: 'readonly',
                location: 'readonly',
                DiagramModel: 'readonly',
                DiagramData: 'readonly',
            },
        },
        rules: { 'jsdoc/require-jsdoc': 'off', 'no-var': 'off', 'prefer-const': 'off', 'prefer-arrow-callback': 'off' },
    },
    {
        // Data-shape interfaces mirror the JSON files documented in docs/SPEC.md; per-field JSDoc adds noise.
        files: ['tools/**/*.ts', 'src/lib/registers/types.ts', 'src/lib/modbus/result.ts', 'src/lib/modbus/frame.ts'],
        rules: { 'jsdoc/require-jsdoc': 'off' },
    },
];
