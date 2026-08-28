// cascade/cascade-back — back abandons the board and ends the sequence.
//
// specs/modes/cascade.md "The sequence": "`back` during `playing` abandons the
// board and returns to `title`, ending the sequence: starting Cascade again
// begins a fresh one from tier `1`" — and entry itself sets `solvedCount` to 0.
//
// The run being abandoned is a real one: four boards are genuinely solved first
// (solvedCount 4, tier 2), so "fresh" afterwards is distinguishable from "the
// run that was left". The solve is done by the case's own spec-derived solver
// through `solveGenerated`; the boards being solvable at all is
// `boards-are-solvable`'s point, so a sweep that did not solve fails here as an
// unmet precondition, named as such.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  fireAction,
  solveGenerated,
  startCascade,
  type Harness,
} from "../harness";

const SEED = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("back during playing returns to title, and re-entering starts fresh", async () => {
  const sweep = await solveGenerated(h, 4, SEED);
  for (const [index, after] of sweep.afterSolve.entries()) {
    assertEqual(
      after.solved,
      true,
      `precondition: board ${index + 1} of the arranging sweep solved (see boards-are-solvable)`,
    );
  }

  // Off the fourth solved screen onto a board of the run in progress.
  await fireAction(h, "confirm");
  const playing = await h.snapshot();
  assertEqual(playing.screen, "playing", "precondition: a run in progress");
  assertEqual(playing.solvedCount, 4, "precondition: four boards solved");

  // back abandons the board and ends the sequence.
  await fireAction(h, "back");
  const abandoned = await h.snapshot();
  assertEqual(
    abandoned.screen,
    "title",
    "back during playing returns to title",
  );

  // Starting Cascade again begins a fresh sequence.
  await startCascade(h);
  await captureStill(h, "fresh");
  const fresh = await h.snapshot();
  assertEqual(fresh.screen, "playing", "re-entering puts a board in play");
  assertEqual(fresh.solvedCount, 0, "a fresh sequence: solvedCount");
  assertEqual(fresh.tier, 1, "a fresh sequence: tier");
});
