// Supplied with the project. Do not edit.
//
// Arc Foundry builds to a fully self-contained static bundle: the produced art,
// effects, and audio committed under `assets/` are bundled with it, so the
// output runs with the asset tools absent. `base: "./"` makes the emitted asset
// URLs relative, so the `dist/` output runs correctly whether it is served at
// the root of a static host or from a sub-path.

import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    outDir: "dist",
    assetsDir: "assets",
  },
});
