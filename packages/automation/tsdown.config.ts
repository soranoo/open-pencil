import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: './src/index.ts',
    protocol: './src/protocol.ts'
  },
  platform: 'node',
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: './dist',
  treeshake: false,
  deps: {
    neverBundle: ['puppeteer', 'puppeteer-cluster', 'ws', 'zod', '@t3-oss/env-core', /^node:/],
    onlyBundle: false
  }
})
