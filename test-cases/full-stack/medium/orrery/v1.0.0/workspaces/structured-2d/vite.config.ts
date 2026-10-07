// Supplied with the project. Do not edit.
//
// Orrery builds to a fully self-contained static bundle. `base: "./"` makes the
// emitted asset URLs relative, so the `dist/` output runs correctly whether it
// is served at the root of a static host or from a sub-path. The produced
// sprites, particle systems, and sounds under `assets/` are referenced relative
// to the document or the module that loads them for the same reason.

import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    outDir: "dist",
    assetsDir: "assets",
  },
});
