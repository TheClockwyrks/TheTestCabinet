// states/countdown-duration — the countdown holds between 1 s and 3 s.
//
// specs/ui.md: "The dive countdown holds for at least `1 s` and at most `3 s`
// before play begins ... Both are timed on the simulation's own accumulated time
// rather than on the wall clock, so each gives way after that much game time
// however the frames that carried it were drawn."
//
// SO THE CLOCK READ IS `simTime`, never the host's. specs/state.md has it
// accumulate on every screen, and the span between the moment the screen was
// posed and the moment play began is the hold the specification bounds. A build
// whose countdown is timed on the wall clock reads the same figure here, which is
// exactly what the requirement allows: what it forbids is a hold outside the
// window.
//
// THE WATCH HAS A HARD CEILING. specs/ui.md gives the countdown at most `3 s`, so
// a tick past that is a failure of this point rather than an inconclusive run,
// and the budget is that bound plus the two ticks of measurement slack below.
//
// The screen is posed straight through `setScreen`, because a dive REACHING the
// countdown is `states.dive-opens-countdown`'s point. What holds still while it
// runs is `states.countdown-freeze`.

import { afterEach, beforeEach, it } from "vitest";

import { assertBetween, assertEqual } from "../assert";
import { HOLD_MAX, HOLD_MIN, TICK_HZ } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { ticks } from "../harness";
import { watchScreen } from "./screens";

/**
 * The ceiling on the watch, in ticks.
 *
 * specs/ui.md gives the countdown at most `HOLD_MAX` (`3 s`). Two ticks of slack
 * beyond it is the measurement's own, and nothing more.
 */
const MAX_HOLD_TICKS = ticks(HOLD_MAX) + 2;

/**
 * The uncertainty in the measured hold, in seconds.
 *
 * The countdown begins DURING the tick that poses the screen, and gives way
 * DURING the tick after the last one this watch sampled, so the span read below
 * is the true hold to within two ticks either way. Two ticks is `1/60 s` against
 * a window two seconds wide.
 */
const TICK_SLACK = 2 / TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the countdown between 1 s and 3 s of simulated time", async () => {
  h.debug.setScreen("countdown");
  const opened = h.snapshot();
  // Before the watch, so a failing check still leaves the screen it read.
  captureStill(h, "countdown");
  assertEqual(opened.screen, "countdown", "the screen the hold is timed on");

  const watch = await watchScreen(h, "countdown", MAX_HOLD_TICKS);

  assertEqual(
    watch.hit,
    true,
    `the countdown gives way inside ${String(HOLD_MAX)} s of simulated time ` +
      "(specs/ui.md)",
  );
  assertEqual(
    watch.after.screen,
    "playing",
    "the screen the countdown running out reaches (specs/ui.md)",
  );
  assertBetween(
    watch.after.simTime - opened.simTime,
    HOLD_MIN - TICK_SLACK,
    HOLD_MAX + TICK_SLACK,
    "seconds of the simulation's own accumulated time the dive countdown " +
      "held for (specs/ui.md)",
  );
});
