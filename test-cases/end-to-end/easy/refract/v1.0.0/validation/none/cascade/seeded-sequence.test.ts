// cascade/seeded-sequence — a seed reproduces the same sequence.
//
// specs/modes/cascade.md "Determinism": the sequence is a function of the seed
// alone — "seeding the generator with a given value and solving boards in
// order produces the same boards, in the same order, every time". The reading
// is two real passes over the same seed on one build: the first is solved by
// the case's solver and its boards and routes recorded; the second is reseeded
// with `reset({seed})`, re-entered, and solved with the FIRST pass's routes —
// determinism means they re-apply — comparing each arriving board, in
// notation, against the one the first pass met at that position.
//
// What this decides is the reproduction and nothing beyond it. Whether the
// boards were generated one at a time as they were needed, rather than all six
// the moment the sequence began, is a rule specs/modes/cascade.md states and
// this reading cannot separate: an eager generator reproduces the same six
// boards in the same order on both passes.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { boardToNotation } from "../notation";
import {
  boardFromSnapshot,
  captureStill,
  createHarness,
  drawBeams,
  fireAction,
  solveGenerated,
  startCascade,
  type Harness,
} from "../harness";

const BOARDS = 6;
const SEED = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("two runs from the same seed produce the same first six boards in order", async () => {
  // First pass: solve six boards and keep what arrived, and how it was solved.
  const first = await solveGenerated(h, BOARDS, SEED);
  for (const [index, after] of first.afterSolve.entries()) {
    assertEqual(
      after.solved,
      true,
      `precondition: board ${index + 1} of the first pass solved (see boards-are-solvable)`,
    );
  }

  // Second pass: reseed, re-enter, and hold each arriving board against the
  // first pass's, re-applying the first pass's routes to advance.
  await h.debug.reset({ seed: SEED });
  await h.advance(1);
  await startCascade(h);

  for (let index = 0; index < BOARDS; index += 1) {
    const snapshot = await h.snapshot();
    assertEqual(
      snapshot.screen,
      "playing",
      `board ${index + 1} of the second pass should be in play`,
    );
    if (index === BOARDS - 1) await captureStill(h, "board");

    assertEqual(
      boardToNotation(boardFromSnapshot(snapshot)),
      boardToNotation(first.boards[index]),
      `board ${index + 1}: the seed reproduces it`,
    );

    const verdict = first.verdicts[index];
    if (verdict.status !== "solved") {
      // Unreachable past the precondition above; narrows the type.
      fail(`a solved verdict for board ${index + 1}`, verdict.status);
    }
    await drawBeams(h, verdict.beams);
    const solvedSnapshot = await h.snapshot();
    assertEqual(
      solvedSnapshot.solved,
      true,
      `board ${index + 1}: the first pass's routes re-apply`,
    );
    if (index < BOARDS - 1) await fireAction(h, "confirm");
  }
});
