// Supplied with the project. Do not edit.
//
// Fathom builds to a fully self-contained static bundle. `base: "./"` makes the
// emitted asset URLs relative, so the `dist/` output runs correctly whether it
// is served at the root of a static host or from a sub-path.
//
// The art under `assets/` is served as plain static files rather than imported
// through the bundler: the engine's asset loader resolves every path under the
// `assets/` root, relative to the page, so a frame has to reach the produced
// site under the folder and file name `specs/assets.md` gives it. The dev
// server already serves that tree from the project root; `copyAssets` puts the
// same tree into `dist/` when the site is built.

import { cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const ASSETS = fileURLToPath(new URL("assets", import.meta.url));
const DIST_ASSETS = fileURLToPath(new URL("dist/assets", import.meta.url));

function copyAssets(): Plugin {
  return {
    name: "fathom-copy-assets",
    apply: "build",
    async closeBundle() {
      await cp(ASSETS, DIST_ASSETS, { recursive: true });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [copyAssets()],
  build: {
    target: "es2020",
    outDir: "dist",
    assetsDir: "assets",
  },
});
