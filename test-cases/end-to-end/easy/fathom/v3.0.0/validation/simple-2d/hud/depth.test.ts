// hud/depth — the current depth is on the bottom strip, and it follows the state.
//
// specs/ui.md keeps the depth in the bottom strip, `y` in `[656, 720]`, whenever a
// maze is on screen, and fixes its wording: `DEPTH 1`, `DEPTH 2` and so on. What
// this reads is that the wording is drawn, that it is drawn in that strip, that it
// names the depth the snapshot reports at the same moment, and that it can be seen
// where it stands.
//
// IT IS READ AT TWO DEPTHS, so the readout is shown to FOLLOW the state rather
// than to have been drawn once with a `1` in it. The second is posed through
// `setDepth`, which specs/instrumentation.md has set the depth and what the
// specification derives from it and leave the maze, the plankton, the fog and the
// screen alone — so what changes between the two readings is the depth and
// nothing a reader could confuse for it.
//
// THE BOARD IS EMPTIED OF HUNTERS, so nothing can reach the forager and end the
// dive between the two readings.

import { afterEach, beforeEach, it } from "vitest";

import { assertGreaterThan, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { textRuns } from "../text";
import { frameOps } from "../states/screens";
import { BOTTOM_STRIP, LEGIBLE_MIN, legibility, readoutOf } from "./readouts";

/** The two depths read: the one a dive opens at, and one well below it. */
const DEPTHS = [1, 4] as const;

/** The wording specs/ui.md fixes for the readout. */
function label(depth: number): string {
  return `DEPTH ${String(depth)}`;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws DEPTH n in the bottom strip, legibly, at every depth", async () => {
  await startPlaying(h);
  h.debug.clearPredators();

  for (const [at, depth] of DEPTHS.entries()) {
    h.debug.setDepth(depth);
    h.debug.clearPredators();
    const posed = h.snapshot();
    const drawn = textRuns(await frameOps(h));
    if (at === 0) {
      // Before the assertions, so a failing check still leaves the HUD it read.
      captureStill(h, "hud");
    }

    const run = readoutOf(drawn, BOTTOM_STRIP, label(posed.depth));
    assertNotNull(
      run,
      `a run of text reading ${label(posed.depth)} for the depth the snapshot ` +
        "reports, drawn with its anchor in the bottom strip y in " +
        `[${String(BOTTOM_STRIP.y0)}, ${String(BOTTOM_STRIP.y1)}] ` +
        "(specs/ui.md)",
    );
    if (run === null) continue;
    assertGreaterThan(
      await legibility(h, run),
      LEGIBLE_MIN,
      "the RGB distance of the depth readout's own furthest pixel from the " +
        "strip behind it, out of 441, sampled across the run drawn at " +
        `(${run.x.toFixed(0)}, ${run.y.toFixed(0)}) (specs/ui.md)`,
    );
  }
});
