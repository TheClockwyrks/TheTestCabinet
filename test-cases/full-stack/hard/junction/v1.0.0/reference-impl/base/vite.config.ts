import { defineConfig } from "vite";

// Junction builds to a fully self-contained static bundle. `base: "./"` makes every
// emitted URL — the JS/CSS, the produced sprites and sprite-sheet frames, the
// particle `system.json` files, and the `.wav` audio — relative, so the `dist/`
// output runs correctly whether it is served at the root of a static host or from a
// per-run sub-path like `/runs/<id>/build/` (specs/assets.md, specs/overview.md).
export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    outDir: "dist",
    assetsDir: "assets",
  },
  // The produced .wav files are bundled as URLs (imported via import.meta.glob with
  // `?url`), so no special asset handling beyond Vite's default is needed.
});
