import { defineConfig, type Options } from 'tsup'

export default defineConfig(
  (cliOptions: Options): Options => ({
    target: 'es2020',
    treeshake: false,
    splitting: false,
    sourcemap: true,
    clean: true,
    dts: true, // Generate .d.ts files
    bundle: true, // Bundle Chevrotain and any other deps
    format: ['esm'],
    entry: ['src/index.ts'],
    // Allows overriding via tsup CLI flags
    ...cliOptions,
  }),
)
