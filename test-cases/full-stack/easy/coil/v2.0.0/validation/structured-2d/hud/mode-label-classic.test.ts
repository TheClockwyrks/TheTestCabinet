// hud/mode-label-classic — the HUD names the mode the round is played in.
//
// specs/ui.md gives the HUD a `Mode` readout, "The mode's short label, as
// `specs/mode.md` fixes it", and specs/mode.md fixes it as `MODE_LABEL`
// (`CLASSIC`). specs/ui.md also puts the whole HUD in the band above the board,
// `y` in `[0, BOARD_Y)`, so the label is required to be a HUD readout rather
// than a word dropped anywhere on the stage.
//
// The word is stated here rather than read off the seeded `src/constants.ts`,
// which carries whichever mode's copy the project was seeded with: this point is
// one of the three each mode states its own version of, so the label it is about
// is the one specs/mode.md fixes for THIS mode.
//
// Matching is by substring and ignores case, because how a build sets the label is
// its own. Anchors are mapped through the transform in force at the call, so a HUD
// drawn at a translated origin reads the same as one drawn in stage coordinates.
//
// The chain is held still and the board is left without a pellet, because what
// this decides is the readout, not the round.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThan } from "../assert";
import {
  HOME_HEAD,
  captureStill,
  chainFrom,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";
import { bandBottom, runsOf } from "./band";

/** `MODE_LABEL` for this mode, as specs/mode.md tables it. */
const LABEL = "CLASSIC";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the mode's label in the HUD band of a live round", async () => {
  poseScene(h, {
    snake: chainFrom(HOME_HEAD, "right", 4),
    dir: "right",
    pellet: null,
    travel: false,
  });

  const calls = await h.frameCalls();
  captureStill(h, "mode");

  const runs = runsOf(calls, LABEL);
  assertGreaterThan(runs.length, 0, `the HUD drawing ${LABEL}`);
  for (const run of runs) {
    assertLessThan(
      run.y,
      bandBottom(h),
      `${LABEL} anchored inside the HUD band`,
    );
  }
});
