// cascade/cascade-restarts-fresh — starting Cascade again begins a fresh
// sequence.
//
// specs/modes/cascade.md "The sequence": backing out of `playing` ends the
// sequence, "starting Cascade again begins a fresh one from tier `1`" — and
// entry itself sets `solvedCount` to 0. That `back` reaches the title at all is
// cascade/cascade-back-to-title's point; here the subject is what the NEXT run
// starts from.
//
// The run being abandoned is a real one: five boards are genuinely solved first
// (solvedCount 5, tier 2), so "fresh" afterwards is distinguishable from "the
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

it("re-entering after a back starts from solvedCount 0 and tier 1", async () => {
  const sweep = await solveGenerated(h, 5, SEED);
  for (const [index, after] of sweep.afterSolve.entries()) {
    assertEqual(
      after.solved,
      true,
      `precondition: board ${index + 1} of the arranging sweep solved (see boards-are-solvable)`,
    );
  }

  // Off the fifth solved screen onto a board of the run in progress, then out.
  await fireAction(h, "confirm");
  assertEqual(
    (await h.snapshot()).solvedCount,
    5,
    "precondition: five boards solved in the run being abandoned",
  );
  await fireAction(h, "back");
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "precondition: back reaches the title (see cascade-back-to-title)",
  );

  // Starting Cascade again begins a fresh sequence.
  await startCascade(h);
  await captureStill(h, "fresh");
  const fresh = await h.snapshot();
  assertEqual(fresh.screen, "playing", "re-entering puts a board in play");
  assertEqual(fresh.solvedCount, 0, "a fresh sequence: solvedCount");
  assertEqual(fresh.tier, 1, "a fresh sequence: tier");
});
