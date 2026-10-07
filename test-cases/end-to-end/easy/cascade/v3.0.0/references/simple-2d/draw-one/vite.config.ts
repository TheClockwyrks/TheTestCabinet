// Supplied with the project. Do not edit.
//
// Cascade builds to a fully self-contained static bundle. `base: "./"` makes the
// emitted asset URLs relative, so the `dist/` output runs correctly whether it is
// served at the root of a static host or from a sub-path.
//
// There is no asset-copying plugin here, and no `assets/` tree to copy: Cascade
// draws every card, the table, the HUD and every screen in code, so the case
// seeds no art at all.

import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    outDir: "dist",
    assetsDir: "assets",
  },
});
