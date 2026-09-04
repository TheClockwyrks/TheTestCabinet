// Refract — cascade/seeded-sequence: a seed reproduces the same sequence.
//
// specs/modes/cascade.md "Determinism": the sequence is a function of the seed
// alone — seeding the generator and solving boards in order produces the same
// boards, in the same order, every time. So the run is made twice from
// reset({seed: 5}): the first pass solves six boards with the spec-derived
// solver and keeps each board and the beams that solved it; the second pass
// asserts each arriving board IS the first pass's board, then re-applies the
// first pass's own beams — determinism means they still solve.
//
// What this decides is the reproduction and nothing beyond it. Whether the
// boards were generated one at a time as they were needed, rather than all six
// the moment the sequence began, is a rule specs/modes/cascade.md states and
// this reading cannot separate: an eager generator reproduces the same six
// boards in the same order on both passes.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  boardFromSnapshot,
  captureStill,
  createHarness,
  solveGenerated,
  startCascade,
  tapAction,
  traceBeams,
  type Harness,
} from "../harness";

/** The manifest's stated recipe: reset({seed: 5}), twice. */
const SEED = 5;
const BOARDS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reproduces the same first six boards, in order, from the same seed", async () => {
  const firstPass = await solveGenerated(h, BOARDS, SEED);

  // The second run of the same seed, on the same build.
  await startCascade(h, SEED);

  for (let k = 0; k < BOARDS; k += 1) {
    const arrival = h.snapshot();
    assertEqual(arrival.screen, "playing", `second pass, board ${k + 1} is up`);
    assertDeepEqual(
      boardFromSnapshot(arrival),
      firstPass[k].board,
      `the seed reproduces board ${k + 1}`,
    );
    if (k === BOARDS - 1) {
      // A board the seed reproduces, as the second pass received it.
      captureStill(h, "board");
    }
    traceBeams(h, firstPass[k].beams);
    assertEqual(
      h.snapshot().solved,
      true,
      `the first pass's beams re-apply on board ${k + 1}`,
    );
    await h.advance(1);
    if (k < BOARDS - 1) {
      await tapAction(h, "confirm");
    }
  }
});
