import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    // Deploy-step migration runner, bundled so the runtime image needs no node_modules.
    migrate: "../../packages/db/migrate.mjs",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: false,
  // Bundle every dependency: the runtime image ships dist/ alone (no pnpm, no
  // node_modules), which removes install/prune drift between build and run.
  noExternal: [/.*/],
  // Some bundled CommonJS deps call require(); give the ESM bundle one.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
