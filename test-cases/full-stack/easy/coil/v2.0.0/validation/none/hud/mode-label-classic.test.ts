// hud/mode-label-classic — the HUD names the mode the round is played in.
//
// specs/ui.md gives the HUD a `Mode` readout, "The mode's short label, as
// `specs/mode.md` fixes it", and specs/mode.md fixes it as `MODE_LABEL`
// (`CLASSIC`). specs/ui.md also puts the whole HUD in the band above the board,
// `y` in `[0, BOARD_Y)`, so the label is required to be a HUD readout rather
// than a word dropped anywhere on the stage.
//
// Matching is by substring and ignores case, because how a build sets the label is
// its own. Anchors are mapped through the transform in force at the call, so a HUD
// drawn at a translated origin reads the same as one drawn in stage coordinates.
//
// The chain is held still and the board is left without a pellet, because what
// this decides is the readout, not the round.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan } from "../assert";
import { MODE_LABEL } from "../constants";
import {
  HOME_HEAD,
  captureStill,
  chainFrom,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";
import { drewText } from "../case-harness/text";
import { BAND_BOTTOM, linesOf } from "./band";

/** `MODE_LABEL` for this mode. */
const LABEL = MODE_LABEL.classic;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the mode's label in the HUD band of a live round", async () => {
  await poseScene(h, {
    snake: chainFrom(HOME_HEAD, "right", 4),
    dir: "right",
    pellet: null,
    travel: false,
  });

  const calls = await h.frameCalls();
  await captureStill(h, "mode");

  assertEqual(drewText(calls, LABEL), true, `the HUD drawing ${LABEL}`);
  for (const run of linesOf(calls, LABEL)) {
    assertLessThan(run.y, BAND_BOTTOM, `${LABEL} anchored inside the HUD band`);
  }
});
