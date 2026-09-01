// Wick — instrumentation/reset-keeps-clock-hold: `reset()` leaves the game off
// real time when a scenario has taken it off: `autoStep` reads `false` after a
// reset issued while it was `false`, and the run's clock stays at `0` while
// real time passes.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `reset(options)`):
// "`autoStep` stays as it is: it belongs to the caller driving the game rather
// than to the session being played, so a `reset` inside a stepped scenario
// leaves the game off the wall clock." And `setAutoStep(auto)`:
// "`setAutoStep(false)` stops the frame loop feeding the wall clock's delta time
// into the tick accumulator, so no tick runs until `step` or `advance` runs
// one."
//
// WHY THE WORLD IS POSED AS IT IS. The harness has already called
// `setAutoStep(false)`, so the reset here is the one the sentence describes. A
// fresh run is then begun and real time allowed to pass with nothing stepping
// it: a build whose reset handed the clock back accumulates ticks while this
// waits, and one that kept the hold accumulates none.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/**
 * Real time allowed to pass with the game off the wall clock: long enough that
 * a loop still feeding the accumulator would have run tens of ticks.
 */
const FROZEN_MS = 500;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves autoStep false across a reset, so the run stays held", async () => {
  assertEqual(
    (await h.snapshot()).autoStep,
    false,
    "autoStep before the reset",
  );

  await h.debug.reset();
  const reset = await h.snapshot();
  assertEqual(
    reset.autoStep,
    false,
    "autoStep after a reset issued while false",
  );

  await h.debug.setScreen("playing");
  await h.page.waitForTimeout(FROZEN_MS);
  const later = await h.snapshot();
  await captureStill(h, "held");
  assertEqual(later.autoStep, false, "autoStep after real time passed");
  assertEqual(later.run.tick, 0, "the run clock while nothing stepped it");
});
