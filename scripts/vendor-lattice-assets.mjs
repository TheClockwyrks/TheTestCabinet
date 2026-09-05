// Re-vendor the Lattice playback assets the UI bundles from their single source of
// truth, the lattice case's replay bundle.
//
// The shared gallery app (`@clockwyrks/ui`) draws a performance run's factory on
// a <canvas> with its own copy of the playback engine + sprite atlas, so the web
// console and desktop app replay a run identically without each fetching the case
// bundle. Only run-specific data (the scenario) is fetched per run; the engine and
// art ship with the bundle. That copy must stay in lockstep with the case's bundle,
// or the UI silently renders with a stale engine/atlas — and because the playback
// engine IS the simulation, a stale wasm would draw a factory that never happened.
//
// The case's REFERENCE playback scenarios ride along for the same reason. The
// test-case Reference tab plays the three scored factories through the vendored
// reference engine, and that tab is not scoped to a run — it is reachable with no run
// at all, and on the static site — so its scenarios cannot come from a run's
// artifacts. They ship with the bundle like the engine and art do. They are generated
// from the scored set by the bundle's own `gen-reference.mjs`.
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
// rebuild `lattice-core.wasm`, repack `sheet.png`/`sheet.json`, and regenerate the
// `reference-*.json` scenarios.

import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const SRC = join(
  repoRoot,
  "test-cases/performance/hard/lattice/v1.0.0/replay/assets",
);
const DST = join(repoRoot, "packages/ui/src/app/pages/runs/lattice/assets");

// The assets the UI vendors verbatim from the bundle: the playback engine, the
// sprite atlas, and the reference scenarios the Reference tab plays through that
// engine. The renderer is deliberately excluded.
export const VENDORED_ASSETS = [
  "lattice-core.wasm",
  "sheet.png",
  "sheet.json",
  "reference-small.json",
  "reference-medium.json",
  "reference-large.json",
];

for (const name of VENDORED_ASSETS) {
  copyFileSync(join(SRC, name), join(DST, name));
  console.log(`vendored ${name}`);
}
