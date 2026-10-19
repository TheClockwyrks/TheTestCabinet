import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, searchForWorkspaceRoot } from "vite";

// Standalone dev server for the Lattice playback preview (packages/ui/preview).
// Run from packages/ui with `npm run dev:preview`. It serves this folder, imports the
// vendored sheet straight from `../src` and the renderer + wasm from
// `@clockwyrks/lattice-runtime`, so what it draws is the real engine and renderer the
// app ships — no backend, no run record.
const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  server: {
    port: 5199,
    // Bind all interfaces so it's reachable from a forwarded port (devcontainer).
    host: true,
    open: false,
    // Allow importing the vendored assets from the parent package and the runtime
    // from the npm workspace (a symlink into the engines checkout).
    fs: { allow: [resolve(here, ".."), searchForWorkspaceRoot(here)] },
  },
});
