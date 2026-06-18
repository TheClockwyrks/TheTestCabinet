import { existsSync, readFileSync } from "node:fs";
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

// Load `.env.site` (if present) into `process.env` before the snapshot plugin
// reads `TCAB_SNAPSHOT_URL`. We avoid a dependency on the `dotenv` package: this
// parses only simple `KEY=VALUE` lines, skips blanks and `#` comments, strips
// surrounding single/double quotes, and never clobbers a variable already set
// in the environment (so a shell export still wins). On Cloudflare Pages the
// variable is set as a build env var, so this file is simply absent there.
function loadEnvSite(projectRoot: string): void {
  const file = resolve(projectRoot, ".env.site");
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      (value[0] === '"' || value[0] === "'") &&
      value[value.length - 1] === value[0]
    ) {
      value = value.slice(1, -1);
    }
    if (key !== "" && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
//
// In dev only, the `localRuns` plugin serves produced-but-unpublished runs from
// the repo's `runs/` directory so they can be previewed (and played) before
// publishing. Point it elsewhere with `TTC_RUNS_DIR`. It self-disables for
// `vite build`, so production stays backend-free.
const here = dirname(fileURLToPath(import.meta.url));
loadEnvSite(here);
const runsDir = process.env.TTC_RUNS_DIR ?? resolve(here, "../../runs");

export default defineConfig({
  plugins: [react(), snapshot(), localRuns({ runsDir })],
});
