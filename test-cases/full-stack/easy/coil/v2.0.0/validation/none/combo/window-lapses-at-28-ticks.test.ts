// combo/window-lapses-at-28-ticks — the window runs out on the 28th tick, and the
// multiplier falls back to one.
//
// specs/scoring.md: the window is a budget of 28 ticks, and "A window that runs
// out with no pellet eaten lapses, and `M` returns to `1` on the tick it lapses."
// specs/movement.md's step 6 is where that happens: "Draw `TICK_SECONDS` off the
// combo window, and lapse the window if it reaches zero."
//
// THE FAR EDGE OF THE BUDGET, the counterpart of `window-open-at-27-ticks`. The
// twenty-seventh tick is read as well as the twenty-eighth, because "on the tick
// it lapses" is a claim about WHICH tick: a build that lapses early is caught by
// the multiplier still standing at 27, and one that lapses late by it having
// fallen at 28.
//
// The snake is held still so the 28 ticks are about the budget rather than about
// how far a chain can run, and the pellet is off the board so nothing can reopen
// the window under the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertGreaterThan } from "../assert";
import { COMBO_WINDOW, COMBO_WINDOW_TICKS, TICK_SECONDS } from "../constants";
import {
  captureReplay,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";

/** The multiplier the round had reached before the window ran out. */
const COMBO = 3;

/** The last tick the window is still open on. */
const BEFORE = COMBO_WINDOW_TICKS - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns the multiplier to one on the 28th tick after the window opened", async () => {
  const posed = await poseScene(h, {
    pellet: null,
    travel: false,
    combo: COMBO,
    comboWindow: COMBO_WINDOW,
  });
  assertCloseTo(posed.comboWindow, COMBO_WINDOW, 9, "the posed window");

  const run = await captureReplay(h, "lapse", async () => {
    const open = await h.tick(BEFORE);
    return { open, lapsed: await h.tick() };
  });

  // Not yet: the window still holds a tick's worth, and M is where it was.
  assertGreaterThan(
    run.open.comboWindow,
    0,
    `the window after ${BEFORE} ticks`,
  );
  assertEqual(run.open.combo, COMBO, `the multiplier after ${BEFORE} ticks`);

  // And on the tick that spends the last of it, the window lapses and M falls.
  assertEqual(run.lapsed.ticks, COMBO_WINDOW_TICKS, "ticks resolved");
  assertCloseTo(
    run.lapsed.comboWindow,
    0,
    9,
    `the window after ${COMBO_WINDOW_TICKS} ticks of ${TICK_SECONDS} each`,
  );
  assertEqual(
    run.lapsed.combo,
    1,
    "the multiplier on the tick the window lapsed",
  );
});
