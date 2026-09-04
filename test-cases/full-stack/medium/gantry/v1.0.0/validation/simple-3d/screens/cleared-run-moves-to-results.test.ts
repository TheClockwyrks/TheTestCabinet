// screens/cleared-run-moves-to-results — a run that ends cleared shows results.
//
// specs/ui.md, "Run": "A cleared run moves to `results`." specs/program.md says
// the same from the run's side: "A run that ends cleared records the site's
// score, the crane's cost and the run clock at the tick it ended on, and moves
// to the results screen."
//
// THE SCENARIO IS A CLEAR REACHED BY THE REAL SIMULATION, not a posed screen: a
// posed `setScreen("results")` would decide nothing about what a clear does. So
// the yard is emptied — no loads, no obstacles — the smallest crane that stands
// is built, and one short move step is run to its end. specs/program.md fixes
// what that ends as: "A tick that finds no live step and no step left to take is
// the tick the run ends on: cleared if every load is `placed`, otherwise failed
// as `loads-unplaced`", and a yard holding no load has every load placed
// vacuously. That is the whole of what this point concerns — a cleared run —
// with no lift, no attach and no set-down to fail on the way there.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The site this runs on; every site clears the same way. */
const SITE = 0;

/**
 * One short hoist move: enough for the tape to have a step and finish it.
 *
 * SHORT BECAUSE THE LENGTH OF THE MOVE IS NOT WHAT THIS DECIDES. What ends a run
 * is "a tick that finds no live step and no step left to take" (specs/program.md),
 * and that tick comes whether the step ran for a second or for a twentieth of
 * one. `HOIST_ACCEL` is `6`, so a move of `0.05` is a real accelerate-and-brake
 * step that arrives inside a fifth of a second — every tick of the run this point
 * concerns, and none of the ticks it does not.
 */
const MOVE = 0.05;
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + MOVE, rate: HOIST_MAX_RATE },
    ],
  },
];

/** Well past the tape's own length, so the cap is a verdict and not a wait. */
const MAX_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows the results screen when a run ends cleared", async () => {
  await openSite(h, SITE);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);

  await startRun(h);
  const ended = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    MAX_TICKS,
    "the run to end",
  );

  assertEqual(
    ended.run.phase,
    "cleared",
    "the run to end cleared, its tape spent with no load left unplaced " +
      "(specs/program.md)",
  );
  assertNull(ended.run.cause, "a cleared run's failure cause");
  assertEqual(
    ended.screen,
    "results",
    "the screen a cleared run moves to (specs/ui.md)",
  );

  await h.capture("state", "the results screen a cleared run moved to");
});
