// Wick — instrumentation/reset-keeps-clock-hold: `reset()` leaves the game off
// real time when a scenario has taken it off: `autoStep` reads `false` after a
// reset issued while it was `false`, and a run posed after the reset moves
// only by the frames the scenario steps.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `reset()`):
// "`autoStep` stays as it is: it belongs to the caller driving the game rather
// than to the session being played, so a `reset` inside a stepped scenario
// leaves the game off the wall clock." And `setAutoStep(auto)`:
// "`setAutoStep(false)` stops the frame loop feeding the wall clock's delta time
// into the tick accumulator, so no tick runs until `step` or `advance` runs
// one"; `step(ticks)`: "On `playing` the update is one whole tick".
//
// WHY THE WORLD IS POSED AS IT IS. The harness has already called
// `setAutoStep(false)`, so the reset here is the one the sentence describes. A
// run is then posed and exactly `DRIVEN` frames stepped: the switch reads
// `false` throughout, and the run clock reads `DRIVEN`, the frames the
// scenario drove and nothing more. Nothing here waits on real time: the hold
// is read off the declared state, which is where the specification puts it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/** Frames the scenario steps after the reset, each one tick on playing. */
const DRIVEN = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves autoStep false across a reset, so the run moves only when stepped", async () => {
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
  assertEqual(reset.run.tick, 0, "the run clock at the reset call");

  await h.debug.setScreen("playing");
  const posed = await h.snapshot();
  assertEqual(
    posed.run.tick,
    0,
    "the run clock of the run posed after the reset",
  );
  const driven = await h.step(DRIVEN);
  await captureStill(h, "held");
  assertEqual(driven.autoStep, false, "autoStep after the scenario's frames");
  assertEqual(
    driven.run.tick,
    DRIVEN,
    "the run clock after the scenario's frames, and nothing else",
  );
});
