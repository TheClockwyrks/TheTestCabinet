import { defineConfig } from "vite";

// Wireworm builds to a fully self-contained static bundle. `base: "./"` makes the
// emitted asset URLs (the bundled JS/CSS and every sprite frame) relative, so the
// `dist/` output runs correctly whether it is served from the root of a static
// host or from a per-run sub-path (see specs/assets.md).
export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    outDir: "dist",
    assetsDir: "assets",
  },
});
