import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The package version, inlined as the OTel `service.version` resource attribute
// for browser telemetry (see src/telemetry.ts).
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
) as { version: string };

// The browser console. A plain SPA: `vite build` emits a static bundle served on
// the private network alongside the backend and workers it talks to.
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 1430,
    strictPort: true,
  },
});
