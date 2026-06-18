import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { localRuns } from "./vite-plugin-local-runs";
import { snapshot } from "./vite-plugin-snapshot";

// Static gallery site. No backend: `vite build` emits a fully static bundle.
//
// The published dataset is the backend's public R2 snapshot. The `snapshot`
// plugin fetches it once at *build* time (from `TCAB_SNAPSHOT_URL`) and inlines
// it into the bundle, so the shipped output is fully static with no live
// dependency on the backend or R2.
//
// In dev only, the `localRuns` plugin serves produced-but-unpublished runs from
// the repo's `runs/` directory so they can be previewed (and played) before
// publishing. Point it elsewhere with `TTC_RUNS_DIR`. It self-disables for
// `vite build`, so production stays backend-free.
const here = dirname(fileURLToPath(import.meta.url));
const runsDir = process.env.TTC_RUNS_DIR ?? resolve(here, "../../runs");

export default defineConfig({
  plugins: [react(), snapshot(), localRuns({ runsDir })],
});
