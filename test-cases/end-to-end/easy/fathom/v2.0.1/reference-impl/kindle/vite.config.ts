import { defineConfig } from "vite";

// Fathom builds to a fully self-contained static bundle. `base: "./"` makes the
// emitted JS/CSS and asset URLs page-relative, so the `dist/` output runs
// correctly whether it is served from the root of a static host or mounted under
// a per-run sub-path (e.g. `/runs/<id>/build/`). The provided art under `assets/`
// is imported through Vite (see src/assets.ts), so it inherits this relative base.
export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    outDir: "dist",
    assetsDir: "assets",
  },
});
