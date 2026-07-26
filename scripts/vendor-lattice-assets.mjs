// Re-vendor the Lattice playback assets the UI bundles from their single source of
// truth, the lattice case's replay bundle.
//
// The shared gallery app (`@test-cabinet/ui`) draws a performance run's factory on
// a <canvas> with its own copy of the playback engine + sprite atlas, so the web
// console and desktop app replay a run identically without each fetching the case
// bundle. Only run-specific data (the scenario) is fetched per run; the engine and
// art ship with the bundle. That copy must stay in lockstep with the case's bundle,
// or the UI silently renders with a stale engine/atlas — and because the playback
// engine IS the simulation, a stale wasm would draw a factory that never happened.
//
// This script copies the binary/JSON assets the UI vendors. It does NOT touch the
// renderer, which is a hand TS port and must be re-ported by hand when the bundle's
// renderer logic changes.
//
// `renderer.vendor.test.ts` asserts the vendored copies are byte-identical to the
// bundle, so a forgotten resync fails CI. Run this to fix such a failure:
//   node scripts/vendor-lattice-assets.mjs
//
// The bundle's own artifacts are regenerated separately — see
// `test-cases/performance/hard/lattice/v1.0.0/replay/assets/README.md` for how to
// rebuild `lattice-core.wasm` and repack `sheet.png`/`sheet.json`.

import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const SRC = join(
  repoRoot,
  "test-cases/performance/hard/lattice/v1.0.0/replay/assets",
);
const DST = join(repoRoot, "packages/ui/src/app/pages/runs/lattice/assets");

// The assets the UI vendors verbatim from the bundle. The renderer is deliberately
// excluded.
export const VENDORED_ASSETS = ["lattice-core.wasm", "sheet.png", "sheet.json"];

for (const name of VENDORED_ASSETS) {
  copyFileSync(join(SRC, name), join(DST, name));
  console.log(`vendored ${name}`);
}
