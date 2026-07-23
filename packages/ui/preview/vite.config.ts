import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Standalone dev server for the Lattice playback preview (packages/ui/preview).
// Run from packages/ui with `npm run dev:preview`. It serves this folder and imports
// the renderer + vendored wasm/sheet straight from `../src`, so what it draws is the
// real engine and renderer the app ships — no backend, no run record.
const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  server: {
    port: 5199,
    // Bind all interfaces so it's reachable from a forwarded port (devcontainer).
    host: true,
    open: false,
    // Allow importing the renderer and vendored assets from the parent package.
    fs: { allow: [resolve(here, "..")] },
  },
});
