// combo/caps-at-max — the multiplier stops at COMBO_MAX.
//
// specs/scoring.md: `M` "is capped at `COMBO_MAX` (`5`)", and the table that
// raises it on an open window says "One higher, up to `COMBO_MAX`".
//
// Its own point because a cap is an edge case and edge cases are where a build's
// arithmetic shows: a build that adds one and clamps somewhere else, or that
// clamps the award but not the multiplier, is right for every eat but this one.
// The window is posed full and open, so nothing but the cap can hold the
// multiplier where it is.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { COMBO_MAX, COMBO_WINDOW } from "../constants";
import {
  arrangeEat,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

/** Ticks of clear travel before the head reaches the pellet. */
const RUN_UP = 3;

/** Ticks run after the eat, so what it left behind is on the recording. */
const SETTLE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the multiplier at COMBO_MAX on an eat inside the window", async () => {
  const scene = await arrangeEat(h, {
    combo: COMBO_MAX,
    comboWindow: COMBO_WINDOW,
    runUp: RUN_UP + 1,
  });
  assertEqual(scene.snapshot.combo, COMBO_MAX, "the posed multiplier");

  const after = await captureReplay(h, "cap", async () => {
    const closing = await h.tick(RUN_UP);
    assertGreaterThan(closing.comboWindow, 0, "the window at the eat");
    const eaten = await h.tick();
    await h.tick(SETTLE);
    return eaten;
  });

  assertEqual(after.combo, COMBO_MAX, "the multiplier after an eat at the cap");
});
