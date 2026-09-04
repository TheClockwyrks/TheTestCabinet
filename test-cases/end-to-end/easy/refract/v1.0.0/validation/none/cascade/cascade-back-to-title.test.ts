// cascade/cascade-back-to-title — back abandons the board and returns to the
// title.
//
// specs/modes/cascade.md "The sequence": "`back` during `playing` abandons the
// board and returns to `title` with `CASCADE` highlighted (`menuIndex = 1`)".
// That the sequence is really ENDED by it — a fresh one starting from tier 1
// afterwards — is cascade/cascade-restarts-fresh's point.
//
// The run being abandoned is a real one: five boards are genuinely solved first
// (solvedCount 5, tier 2), so the board left behind is a board of a run in
// progress. The solve is done by the case's own spec-derived solver through
// `solveGenerated`; the boards being solvable at all is `boards-are-solvable`'s
// point, so a sweep that did not solve fails here as an unmet precondition,
// named as such.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  fireAction,
  solveGenerated,
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

it("back during playing returns to title with CASCADE highlighted", async () => {
  const sweep = await solveGenerated(h, 5, SEED);
  for (const [index, after] of sweep.afterSolve.entries()) {
    assertEqual(
      after.solved,
      true,
      `precondition: board ${index + 1} of the arranging sweep solved (see boards-are-solvable)`,
    );
  }

  // Off the fifth solved screen onto a board of the run in progress.
  await fireAction(h, "confirm");
  const playing = await h.snapshot();
  assertEqual(playing.screen, "playing", "precondition: a run in progress");
  assertEqual(playing.solvedCount, 5, "precondition: five boards solved");

  // back abandons the board.
  await fireAction(h, "back");
  await captureStill(h, "abandoned");
  const abandoned = await h.snapshot();
  assertEqual(
    abandoned.screen,
    "title",
    "back during playing returns to title",
  );
  assertEqual(
    abandoned.menuIndex,
    1,
    "with CASCADE, the entry that led away, highlighted",
  );
});
