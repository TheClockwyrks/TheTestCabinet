// Build the case's REFERENCE PLAYBACK scenarios — the three scored factories,
// windowed to a watchable length — from `../../cases/*.json`.
//
// The console's test-case Reference tab plays these through the vendored reference
// engine (`lattice-core.wasm`), so a reader can see what the case's factories are
// SUPPOSED to look like without waiting for a run. That is the reference half of the
// browser visualization the architecture doc describes: the same renderer, the same
// playback ABI, the authoritative engine instead of a submission's.
//
// The output is the scored scenario VERBATIM — same grid, same entities, in the same
// order — with one change: the timeline is cut to a dense window from tick 0.
//
// ## Why the window
//
// The scored scenarios run 50,000-360,000 ticks, and the reference engine's playback
// driver (`lattice-core`'s `Playback`) emits a full canonical state EVERY tick with
// no cap of its own — a per-tick state lists every item's position, so a full-length
// trace is far too large for the browser to hold. A submission's playback solves this
// in the guest: `lattice-sdk` runs its engine over a bounded dense window
// (`PLAYBACK_WINDOW_TICKS`) and serves those frames. The reference has no such guest
// cap, so the bound is applied HERE, to the scenario itself.
//
// The window deliberately equals the SDK's, so the Reference tab and a run's Results
// tab show the same stretch of the same factory — the reference and the submission
// are watched over identical ticks and are directly comparable. Keep them in step: if
// `PLAYBACK_WINDOW_TICKS` changes, change `WINDOW_TICKS` and regenerate.
//
// A window is the right shape rather than a crop (what `packages/ui/preview`'s
// dev-only `gen-preview-scenarios.mjs` does to peek at the layouts): the Reference tab
// shows the WHOLE scored factory, edge to edge, just not to its final tick. The
// warm-up — sources priming, the sub-bus lanes filling, splitters reaching balance —
// is the visually interesting stretch anyway; the far scored ticks are steady state.
//
// Run: node test-cases/performance/hard/lattice/v1.0.0/replay/assets/gen-reference.mjs
// Then re-vendor into the UI:  node scripts/vendor-lattice-assets.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const casesDir = join(here, "../../cases");

// Mirrors `PLAYBACK_WINDOW_TICKS` in `crates/lattice-sdk/src/lib.rs`. See above for
// why the two must stay equal.
const WINDOW_TICKS = 2500;

// The scored scenarios, in the manifest's order (which is also their progression:
// the small correctness confirmation, then the two main-bus factories).
const SCORED = ["small", "medium", "large"];

/**
 * The scored scenario with its timeline cut to `WINDOW_TICKS` (or left alone if it
 * is already shorter). Grid and entities pass through untouched — this is the scored
 * layout, not an approximation of it.
 *
 * The snapshot schedule has to be rewritten with the timeline: `Scenario::parse`
 * rejects a snapshot tick outside `1..=ticks`, so the committed schedule (three
 * checkpoints, the last at the scored end tick) cannot survive the cut. It is
 * replaced by the same three-checkpoint shape scaled into the window. Nothing is
 * graded here, so the schedule only has to be valid and evenly spaced: the renderer
 * draws every tick regardless, and reads the schedule solely to know where a run
 * would have checksummed.
 */
function window(scenario) {
  const ticks = Math.min(scenario.ticks, WINDOW_TICKS);
  return {
    version: scenario.version,
    grid: scenario.grid,
    ticks,
    snapshots: [Math.round(ticks / 4), Math.round(ticks / 2), ticks],
    entities: scenario.entities,
  };
}

for (const name of SCORED) {
  const scored = JSON.parse(
    readFileSync(join(casesDir, `${name}.json`), "utf8"),
  );
  const out = join(here, `reference-${name}.json`);
  // Two-space JSON with a trailing newline, matching the committed scored
  // scenarios — the vendored copies are compared byte for byte, so the formatting
  // has to be reproducible.
  writeFileSync(out, `${JSON.stringify(window(scored), null, 2)}\n`);
  console.log(
    `wrote reference-${name}.json (${scored.ticks} -> ${Math.min(
      scored.ticks,
      WINDOW_TICKS,
    )} ticks, ${scored.entities.length} entities)`,
  );
}
