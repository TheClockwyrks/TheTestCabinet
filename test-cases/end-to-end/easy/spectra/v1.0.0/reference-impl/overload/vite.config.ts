import { defineConfig } from "vite";

// Spectra builds to a fully self-contained static bundle. `base: "./"` makes every
// emitted asset URL (JS, CSS, the seeded sprites, the drone-burst JSON) relative,
// so the `dist/` output runs correctly whether it is served at the root of a
// static host or from a per-run sub-path (specs/assets.md, specs/overview.md).
export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    outDir: "dist",
    assetsDir: "assets",
  },
});
