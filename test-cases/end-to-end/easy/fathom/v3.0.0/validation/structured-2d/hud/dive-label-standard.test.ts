// hud/dive-label-standard — the dive label reads STANDARD.
//
// specs/ui.md keeps a small, dim label in the top strip, `y` in `[0, 80]`, naming
// the dive being played, whenever a maze is on screen. It is the one thing on the
// HUD the two dives disagree about, which is why it lives in `variants/base.toml`
// rather than beside the other five, and why this file has a sibling that asserts
// the other word.
//
// WHAT IS ASSERTED, AND WHAT IS NOT. That the word is drawn, that it is drawn with
// its anchor in the top strip, and that it can be seen where it stands — its own
// furthest pixel more than `LEGIBLE_MIN` of `441` from the ground behind it. That
// it is "small" and "dim" is not: specs/ui.md fixes no size and no palette, and a
// build that draws it in the type it chose is doing what that file asks. How the
// HUD LOOKS is the aesthetic rating's.
//
// THE BOARD IS EMPTIED OF HUNTERS, so nothing can reach the forager and end the
// dive between the pose and the reading.

import { afterEach, beforeEach, it } from "vitest";

import { assertGreaterThan, assertNotNull } from "../assert";
import { DIVE_LABEL_BASE } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { textDraws } from "../text";
import { frameOps } from "../states/screens";
import { LEGIBLE_MIN, TOP_STRIP, legibility, readoutOf } from "./readouts";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the STANDARD dive label in the top strip, legibly", async () => {
  startPlaying(h);
  h.debug.clearPredators();

  const drawn = textDraws(await frameOps(h));
  // Before the assertions, so a failing check still leaves the HUD it read.
  captureStill(h, "hud");

  const run = readoutOf(drawn, TOP_STRIP, DIVE_LABEL_BASE);
  assertNotNull(
    run,
    `a run of text carrying the dive label ${DIVE_LABEL_BASE}, drawn with its anchor ` +
      `in the top strip y in [${String(TOP_STRIP.y0)}, ${String(TOP_STRIP.y1)}] ` +
      "(specs/ui.md)",
  );
  if (run === null) return;
  assertGreaterThan(
    await legibility(h, run),
    LEGIBLE_MIN,
    "the RGB distance of the dive label's own furthest pixel from the strip " +
      "behind it, out of 441, sampled across the run drawn at " +
      `(${run.x.toFixed(0)}, ${run.y.toFixed(0)}) (specs/ui.md)`,
  );
});
