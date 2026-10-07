// Supplied with the project. Do not edit.
//
// Facet builds to a fully self-contained static bundle. `base: "./"` makes the
// emitted asset URLs relative, so the `dist/` output runs correctly whether it
// is served at the root of a static host or from a sub-path, which is also what
// keeps the produced art and sound under `public/assets/` resolving once the
// build is mounted somewhere other than an origin root.

import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    outDir: "dist",
    assetsDir: "assets",
  },
});
