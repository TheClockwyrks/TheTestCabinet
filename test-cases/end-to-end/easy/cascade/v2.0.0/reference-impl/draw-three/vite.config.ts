import { defineConfig } from "vite";

// Cascade builds to a fully self-contained static bundle. `base: "./"` makes the
// emitted asset URLs relative, so the `dist/` output runs correctly whether it is
// served at the root of a static host or from a sub-path.
export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    outDir: "dist",
    assetsDir: "assets",
  },
});
