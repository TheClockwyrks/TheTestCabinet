import { defineConfig } from "vite";

// Coil builds to a fully self-contained static bundle. `base: "./"` makes every emitted
// URL — the JS/CSS, the produced snake sprites and sprite-sheet head frames, and the
// `.wav` audio — page-relative, so the `dist/` output runs correctly whether it is served
// at the root of a static host or mounted under a per-run sub-path like `/runs/<id>/build/`
// (specs/assets.md, specs/overview.md).
export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    outDir: "dist",
    assetsDir: "assets",
    // Emit every produced asset as a real page-relative file under dist/assets (never inlined
    // as a base64 data URI), so the snake sprites and audio ship as files exactly as the
    // production contract describes and a served sub-path can be checked for them.
    assetsInlineLimit: 0,
  },
});
