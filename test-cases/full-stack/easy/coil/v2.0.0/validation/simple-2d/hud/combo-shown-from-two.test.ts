// hud/combo-shown-from-two — from a multiplier of two upward the HUD names it.
//
// specs/ui.md gives the HUD a `Combo` readout: "The multiplier as `x2` through
// `x5`, with a bar beneath it", shown "only while `M` is at least `2`". Posed at
// `3`, the frame must therefore say `x3`: a player who cannot see the multiplier
// cannot see the point of chasing the next pellet quickly, which is the game's
// defining idea.
//
// `×` is accepted beside `x` because a build is free to set the multiplier with
// the multiplication sign, and the space between them is optional for the same
// reason. What is not optional is the figure, which is why `3` is read rather
// than any digit. The text read is the LOGICAL runs the frame spelled
// (`drawnTextLines`), so a readout letter-spaced into an `x` and a `3` a call
// apart still reads as `x3`.
//
// The window is posed full, so the readout is being asked for in the state
// specs/scoring.md puts it in after a combo has just risen.

import { afterEach, beforeEach, it } from "vitest";
import { COMBO_WINDOW } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import { drawnTextLines } from "../case-harness/text";
import {
  HOME_HEAD,
  captureStill,
  chainFrom,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";

/** The multiplier the HUD is posed at, and the readout that names it. */
const COMBO = 3;
const READOUT = new RegExp(`[x×]\\s*${COMBO}`, "i");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the multiplier as x3 at a multiplier of three", async () => {
  const live = poseScene(h, {
    snake: chainFrom(HOME_HEAD, "right", 4),
    dir: "right",
    pellet: null,
    travel: false,
    combo: COMBO,
    comboWindow: COMBO_WINDOW,
  });
  assertEqual(live.combo, COMBO, "the multiplier the HUD is read at");

  const calls = await h.frameCalls();
  captureStill(h, "shown");

  assertGreaterThan(
    drawnTextLines(calls).filter((run) => READOUT.test(run)).length,
    0,
    `the HUD drawing the multiplier as x${COMBO}`,
  );
});
