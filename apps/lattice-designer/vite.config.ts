import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { scenarioApi } from "./scenario-api";

// The Lattice renderer, interpolation, and the `lattice-core` wasm + sprite sheet
// all live inside the console UI package at `pages/runs/lattice`. They are pure
// (the renderer imports nothing but its sibling `interpolate`, and the assets are
// plain files), so this dev tool reuses them by aliasing straight to that folder
// rather than reaching through the package's public exports or vendoring a second
// copy of the 350 KB wasm. `.pathname` keeps the config free of a `node:*` import.
const lattice = new URL(
  "../../packages/ui/src/app/pages/runs/lattice",
  import.meta.url,
).pathname;

// The Lattice factory designer. A plain SPA dev tool: `vite build` emits a static
// bundle, but it is normally run with `vite dev` while authoring a factory. Only the
// dev server carries `scenarioApi`, which is what lets the tool open and save the
// case's committed scenarios; a built bundle can still export/download.
export default defineConfig({
  plugins: [react(), scenarioApi()],
  resolve: {
    alias: { "@lattice": lattice },
  },
  server: {
    port: 1431,
    strictPort: true,
  },
});
