// combo/window-drains-while-held — the window drains on every tick that resolves,
// however the snake is being held.
//
// specs/instrumentation.md, on the driver: "Step 6 runs on every tick whatever the
// switches say, so the combo window drains by `TICK_SECONDS` and lapses on
// schedule even while the snake is held still, and `ticks` counts every tick that
// resolves." specs/scoring.md fixes the budget the drain spends: 28 ticks.
//
// WHY IT IS A REVIEW POINT RATHER THAN A HARNESS DETAIL. The window is a budget of
// simulation time, not of travel, and a build that drains it inside the code that
// moves the snake ties the two together: the player who stops steering, or the
// scenario that holds the chain, keeps a combo the specification says they have
// spent. It is also the property nearly every combo scenario in this directory
// rests on, since each of them drains the window with the snake held.
//
// Both switches are off, and the chain and the heading are read back at the end to
// show they really were held for the whole run.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertDeepEqual, assertEqual } from "../assert";
import { COMBO_WINDOW, TICK_SECONDS } from "../constants";
import {
  captureReplay,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";

/** The budget the window is, in ticks, as specs/scoring.md counts it. */
const BUDGET_TICKS = Math.round(COMBO_WINDOW / TICK_SECONDS);

/** Ticks driven before the halfway reading, which is a plain drain. */
const PART = BUDGET_TICKS / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("spends the whole window over its 28 ticks with the snake held", async () => {
  const posed = poseScene(h, {
    pellet: null,
    travel: false,
    steering: false,
    combo: 3,
    comboWindow: COMBO_WINDOW,
  });
  assertEqual(posed.travel, false, "the travel switch the scene posed");
  assertEqual(posed.steering, false, "the steering switch the scene posed");

  const run = await captureReplay(h, "held", async () => {
    const part = await h.tick(PART);
    return { part, spent: await h.tick(BUDGET_TICKS - PART) };
  });

  // Every tick took its TICK_SECONDS, half way through and at the end.
  assertCloseTo(
    run.part.comboWindow,
    COMBO_WINDOW - PART * TICK_SECONDS,
    9,
    `the window after ${PART} ticks with the snake held`,
  );
  assertEqual(run.spent.ticks, BUDGET_TICKS, "ticks resolved while held");
  assertCloseTo(
    run.spent.comboWindow,
    0,
    9,
    `the window after ${BUDGET_TICKS} ticks with the snake held`,
  );

  // And the snake really was held for all of it.
  assertDeepEqual(
    run.spent.snake,
    posed.snake,
    "the chain over the whole window",
  );
  assertEqual(run.spent.dir, posed.dir, "the heading over the whole window");
});
