import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
  },
  {
    entry: ['src/bin.ts'],
    format: ['esm'],
    dts: false,
    sourcemap: true,
    clean: false,
    splitting: false,
    banner: { js: '#!/usr/bin/env node' },
  },
]);
