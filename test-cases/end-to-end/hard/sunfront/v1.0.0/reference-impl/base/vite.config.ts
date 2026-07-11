import { defineConfig } from "vite";

// Sunfront builds to a fully self-contained static bundle. `base: "./"` makes every
// emitted asset URL (JS, CSS) relative, and — together with the page-relative fetches
// the game does at runtime for `assets/models.json`, each entity's `rig.json` and its
// `meshes/*.glb` parts, and the `assets/effects/*.json` muzzle systems — lets the
// `dist/` output run correctly whether it is served at the root of a static host or
// from a per-run sub-path (specs/assets.md, specs/overview.md).
export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    outDir: "dist",
    assetsDir: "assets",
  },
});
