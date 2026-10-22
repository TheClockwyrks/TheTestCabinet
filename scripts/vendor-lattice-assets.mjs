// Re-vendor the lattice version's own playback content the UI bundles from its
// single source of truth, the lattice case's replay bundle.
//
// The shared gallery app (`@clockwyrks/ui`) draws a performance run's factory on
// a <canvas> through `@clockwyrks/lattice-runtime`, which carries the renderer, the
// interpolation and the reference engine (`lattice-core` compiled to the playback
// ABI). What the runtime does not carry is the case's content: the sprite atlas the
// renderer draws with, and the REFERENCE playback scenarios. Those ship with the UI
// bundle, so the web console and the public site replay a run identically without
// each fetching the case bundle; only run-specific data (the scenario) is fetched
// per run. The copy must stay in lockstep with the case's bundle, or the UI silently
// draws with a stale atlas.
//
// The reference scenarios ride along for the same reason. The test-case Reference
// tab plays the three scored factories through the runtime's reference engine, and
// that tab is not scoped to a run — it is reachable with no run at all, and on the
// static site — so its scenarios cannot come from a run's artifacts. They are
// generated from the scored set by the bundle's own `gen-reference.mjs`.
//
// The copies live in the ui-common checkout, whose package ships them, and are
// committed there. console.testcabinet.ai's `apps/web/src/lattice-assets.test.ts` asserts the copies the
// resolved `@clockwyrks/ui` ships are byte-identical to the bundle, so a
// forgotten resync fails CI. Run this to fix such a failure (then rebuild the
// package and commit the copies in ui-common):
//   node scripts/vendor-lattice-assets.mjs
//
// The bundle's own artifacts are regenerated separately — see
// `test-suites/test-cases/performance/hard/lattice/v1.0.0/replay/assets/README.md` for how to
// repack `sheet.png`/`sheet.json` and regenerate the `reference-*.json` scenarios.

import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const SRC = join(
  repoRoot,
  "test-suites/test-cases/performance/hard/lattice/v1.0.0/replay/assets",
);
const DST = join(
  repoRoot,
  "ui-common/packages/ui/src/app/pages/runs/lattice/assets",
);

// The assets the UI vendors verbatim from the bundle: the sprite atlas, and the
// reference scenarios the Reference tab plays through the runtime's engine. The
// engine and the renderer come from `@clockwyrks/lattice-runtime`, not from here.
export const VENDORED_ASSETS = [
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
