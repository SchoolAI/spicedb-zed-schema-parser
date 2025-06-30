import { defineConfig, type Options } from 'tsup'

export default defineConfig(
  (cliOptions: Options): Options => ({
    splitting: false,
    sourcemap: true,
    clean: true,
    dts: true, // Generate .d.ts files
    format: ['esm'], // Output ESModule
    entry: ['src/index.ts', 'src/types.ts'],
    // Allows overriding via tsup CLI flags
    ...cliOptions,
  }),
)
