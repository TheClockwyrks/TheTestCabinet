import { defineConfig } from "vite";

// Floe builds to a fully self-contained static bundle. `base: "./"` makes every
// emitted URL — the entry script, CSS, and the bundled sprite art — page-relative,
// so `dist/` runs correctly whether it is served from the root of a static host or
// mounted under a per-run sub-path (see specs/assets.md).
export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    outDir: "dist",
    assetsDir: "assets",
  },
});
