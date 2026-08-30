// combo/window-open-at-27-ticks — the window is still open one tick short of its
// budget.
//
// specs/scoring.md: the window is `COMBO_WINDOW` (3.5 s) of simulation time, step
// 6 draws `TICK_SECONDS` off it each tick, "so the window is a budget of 28 ticks,
// which is 28 cells of travel", and it "is open while time remains on it".
// Twenty-seven ticks leave `0.125` of a second on it, so it is open, and an eat on
// that tick raises `M` instead of resetting it.
//
// THE NEAR EDGE OF THE BUDGET, and the far edge is `window-lapses-at-28-ticks`.
// The two are separate points because they catch opposite off-by-ones: a build
// that lapses a tick early takes a combo away from a player who made the deadline,
// and one that lapses a tick late hands out a combo that was not earned.
//
// The snake is held still while the window drains, so the reading is about the
// budget rather than about how far a chain can run before it meets a wall; travel
// is turned back on for the eat itself, which is the tick under test.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertGreaterThan } from "../assert";
import { COMBO_WINDOW, TICK_SECONDS } from "../../src/constants";
import {
  arrangeEat,
  captureReplay,
  createHarness,
  gateTravel,
  type Harness,
} from "../harness";

/** The multiplier in force, clear of both the opening 1 and the cap. */
const COMBO = 2;

/** Ticks spent off a full window before the eat: one short of its budget. */
const SPENT = Math.round(COMBO_WINDOW / TICK_SECONDS) - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises the multiplier on an eat 27 ticks after the window opened", async () => {
  arrangeEat(h, {
    combo: COMBO,
    comboWindow: COMBO_WINDOW,
    travel: false,
  });

  const run = await captureReplay(h, "open", async () => {
    const waited = await h.tick(SPENT);
    gateTravel(h, true);
    return { waited, eaten: await h.tick() };
  });

  // Still open, and the multiplier has not lapsed, one tick short of the budget.
  assertCloseTo(
    run.waited.comboWindow,
    COMBO_WINDOW - SPENT * TICK_SECONDS,
    9,
    `the window after ${SPENT} ticks`,
  );
  assertGreaterThan(
    run.waited.comboWindow,
    0,
    `the window after ${SPENT} ticks`,
  );
  assertEqual(run.waited.combo, COMBO, `the multiplier after ${SPENT} ticks`);

  // So the eat on the next tick meets an open window and raises M.
  assertEqual(run.eaten.combo, COMBO + 1, "the multiplier the eat resolved at");
});
