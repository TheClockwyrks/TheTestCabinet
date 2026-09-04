// progression/ending-holds — an ending holds until something dismisses it.
//
// THE SPEC LINE. `specs/progression.md` — "Interludes and endings": "An ending
// holds until it is dismissed." The ending is where a run stops, so it waits
// for the player rather than for a clock.
//
// WHY IT IS ITS OWN POINT. A build whose ending times out reaches the title
// with nothing having dismissed it, and a player who looked away misses the
// score the screen was there to report. It is also the precondition every
// other dismissal point rests on: if the screen moved on its own, a press that
// followed would decide nothing.
//
// THE DRIVE. `progression/ending.ts` poses the ended run, and a second of play
// is stepped with nothing pressed. `specs/ui.md` advances the simulation on
// `playing`, `cleared` and `setback` alone, so the only thing those ticks can
// move is a build's own ending timer.
//
// THE TOLERANCE. None: the screen is an exact comparison, and the length of
// the hold is a drive length rather than a threshold.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureReplay, createHarness, type Harness } from "../harness";
import { HOLD_TICKS, poseEnding } from "./ending";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds an ending for a second of play with nothing pressed", async () => {
  await poseEnding(h);

  const held = await captureReplay(h, "held", () => h.step(HOLD_TICKS));

  assertEqual(
    held.screen,
    "gameover",
    `the screen ${HOLD_TICKS} ticks after the ending was reached, with nothing pressed`,
  );
});
