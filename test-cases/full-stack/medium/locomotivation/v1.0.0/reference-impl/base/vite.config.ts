import { defineConfig } from "vite";

// Locomotivation builds to a fully self-contained static bundle. `base: "./"` makes
// every emitted URL — the JS/CSS, the produced worker sprite-sheet frames, train and
// tile sprites, the particle `system.json` files, and the `.wav` audio — PAGE-RELATIVE,
// so the `dist/` output runs correctly whether served at the root of a static host or
// from a per-run sub-path like `/runs/<id>/build/` (specs/assets.md, specs/overview.md).
// Never use a root-absolute `/assets/…` URL anywhere in the game.
export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    outDir: "dist",
    assetsDir: "assets",
  },
  // Produced assets are imported through the bundler with `import.meta.glob(..., "?url")`
  // so Vite fingerprints and rewrites every path relative to the page; no special asset
  // handling beyond Vite's default is required.
});
