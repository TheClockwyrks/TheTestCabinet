import { defineConfig } from "vite";

// Deepcore builds to a fully self-contained static bundle. `base: "./"` makes every
// emitted URL — the JS/CSS, the produced miner sprite-sheet frames and environment
// sprites, the particle `system.json` files, and the `.wav` audio — relative, so the
// `dist/` output runs correctly whether it is served at the root of a static host or
// from a per-run sub-path like `/runs/<id>/build/` (specs/assets.md, specs/overview.md).
export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    outDir: "dist",
    assetsDir: "assets",
  },
  // The produced .wav files and sprite/JSON assets are bundled as URLs (imported via
  // import.meta.glob with `?url`), so no special asset handling beyond Vite's default
  // is needed.
});
