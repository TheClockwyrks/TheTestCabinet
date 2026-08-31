// presentation/hud-timer — the timer readout is drawn in the HUD bar and follows
// the crossing timer.
//
// specs/ui.md's HUD table gives the fourth readout "The seconds left on the
// crossing timer, following `timer`", inside the bar specs/strait.md puts at `y`
// in `[0, HUD_H]`. What this point decides is that relation: the readout shows one
// figure with the timer posed at one value and a different figure with it posed at
// another, so a build that draws a fixed number, or the crossing time it opened
// with, fails.
//
// THE TIMER IS POSED AND NEVER RUN. `setTimerRunning` stays OFF throughout, as
// `startCrossing` leaves it, so the reading is of the readout FOLLOWING THE FIELD
// rather than of the drain — which is `progression/timer-costs-life`'s point and
// the one that opens that gate. `setTimer` "sets the crossing timer. It kills
// nothing: the next tick does" (specs/instrumentation.md), so nothing about the
// crossing changes between the two readings but the field itself.
//
// BOTH VALUES ARE WHOLE SECONDS, and neither can come from another readout: the
// score is `0`, the lives `3` and the level `1` of `8`, so a run reading `21` or
// `14` is the timer readout. Whole seconds because how many decimals a build shows
// is its own business — `21` reads as `21` whether it is drawn `21`, `21.0` or
// `0:21` — while a posed `20.5` would be read differently by a build that rounds
// and one that truncates, and specs/ui.md fixes neither.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  startCrossing,
  type Harness,
} from "../harness";
import { describeRuns, hudRuns, runsShowing } from "./readout";

/** The two posed values, in whole seconds of crossing timer. */
const FIRST = 21;
const SECOND = 14;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the posed timer in the HUD bar and follows it to a second value", async () => {
  startCrossing(h);

  h.debug.setTimer(FIRST);
  const before = hudRuns(h, await drawFrame(h));
  captureStill(h, "hud");
  const stillPosed = h.snapshot();

  h.debug.setTimer(SECOND);
  const after = hudRuns(h, await drawFrame(h));

  // The situation: the timer is not draining, so the field is what moved.
  assertEqual(
    stillPosed.timerRunning,
    false,
    "the crossing timer stays posed rather than draining " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    stillPosed.timer,
    FIRST,
    `the timer holds the posed ${FIRST} seconds (specs/instrumentation.md)`,
  );

  assertGreaterThanOrEqual(
    runsShowing(before, FIRST).length,
    1,
    `a run of text inside the HUD bar reading ${FIRST}, the posed seconds ` +
      `left (specs/ui.md) — the bar drew ${describeRuns(before)}`,
  );
  assertGreaterThanOrEqual(
    runsShowing(after, SECOND).length,
    1,
    `a run of text inside the HUD bar reading ${SECOND} once the timer was ` +
      `posed there (specs/ui.md) — the bar drew ${describeRuns(after)}`,
  );
  assertLength(
    runsShowing(after, FIRST),
    0,
    `runs still reading the old ${FIRST} seconds after the timer was posed ` +
      `to ${SECOND} — the readout follows timer (specs/ui.md)`,
  );
});
