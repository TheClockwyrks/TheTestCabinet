// presentation/hud-score — the score is drawn in the HUD bar, and the figure it
// shows follows the score.
//
// specs/ui.md gives the HUD five readouts and gives the first of them "The running
// score", inside the bar specs/strait.md puts at `y` in `[0, HUD_H]`: "Their
// arrangement and styling are yours; each is inside the bar and legible against
// it." So this point asserts exactly two things — that a run of text inside the
// bar reads as the score, and that the run reading the OLD score is gone once the
// score changes — and nothing about where in the bar it sits or what it is
// labelled.
//
// TWO POSED VALUES, NOT ONE. A build that draws a fixed figure, or that draws the
// score it had at load, passes a single reading and fails here: the second value
// must be drawn AND the first must no longer be. The two are `1234` and `5678`,
// which no other readout of this posed crossing can produce — the lives read `3`,
// the level `1` out of `8` and the timer the level-1 crossing time — so a run
// reading either of them is the score readout and nothing else.
//
// THE SCORE IS POSED, NOT EARNED. `setScore` "sets the score. It grants no bonus
// life: this is a precondition" (specs/instrumentation.md), so what is read is the
// readout following the field. What the game ADDS to the score is the `scoring`
// group's, and a crossing that hopped its way to a score would drag every rule of
// the crossing into a point about the HUD.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  startCrossing,
  type Harness,
} from "../harness";
import { describeRuns, hudRuns, runsShowing } from "./readout";

/** The first score posed, and the second. Neither collides with a readout. */
const FIRST = 1234;
const SECOND = 5678;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the score in the HUD bar and follows it when it changes", async () => {
  startCrossing(h);

  h.debug.setScore(FIRST);
  const before = hudRuns(h, await drawFrame(h));
  captureStill(h, "hud");

  h.debug.setScore(SECOND);
  const after = hudRuns(h, await drawFrame(h));

  assertGreaterThanOrEqual(
    runsShowing(before, FIRST).length,
    1,
    `a run of text inside the HUD bar reading ${FIRST}, the posed score ` +
      `(specs/ui.md) — the bar drew ${describeRuns(before)}`,
  );
  assertGreaterThanOrEqual(
    runsShowing(after, SECOND).length,
    1,
    `a run of text inside the HUD bar reading ${SECOND} once the score was ` +
      `posed there (specs/ui.md) — the bar drew ${describeRuns(after)}`,
  );
  assertLength(
    runsShowing(after, FIRST),
    0,
    `runs still reading the old score ${FIRST} after it changed to ` +
      `${SECOND} — the readout shows the running score (specs/ui.md)`,
  );
});
