// cascade/sequence-is-endless — the sequence has no last board.
//
// specs/modes/cascade.md: "MAX_TIER is the top of the ladder and holds from the
// twentieth board solved onward. Play continues there indefinitely, on fresh
// boards each time", and "solving a board hands the player the next one...
// There is no last board." Read as far as a suite can honestly read an
// "indefinitely": the sweep drives PAST the twentieth solve — twenty-five
// boards — and requires that beyond it NEXT BOARD keeps producing boards that
// keep the generator's contract (notation.ts's validateBoard, the structural
// legality of specs/board.md and the generator table) at MAX_TIER, with
// solvedCount still rising by one per board solved. The first twenty solves are
// this point's runway, not its subject; a runway that did not solve fails as a
// named precondition.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { MAX_TIER, validateBoard } from "../notation";
import {
  captureStill,
  createHarness,
  solveGenerated,
  type Harness,
  type RefractSnapshot,
} from "../harness";

const SWEEP = 25;
const SEED = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("past the twentieth solve, NEXT BOARD keeps producing boards and the count keeps rising", async () => {
  const arrivals: RefractSnapshot[] = [];
  const sweep = await solveGenerated(
    h,
    SWEEP,
    SEED,
    async (snapshot, index) => {
      arrivals.push(snapshot);
      if (index === SWEEP - 1) await captureStill(h, "board");
    },
  );

  assertEqual(
    sweep.afterSolve[19].solvedCount,
    20,
    "precondition: twenty boards solved on the way up (see boards-are-solvable)",
  );

  for (let index = 20; index < SWEEP; index += 1) {
    const at = `board ${index + 1}, past the twentieth solve`;
    assertEqual(arrivals[index].tier, MAX_TIER, `${at}: generated at MAX_TIER`);
    assertDeepEqual(
      validateBoard(sweep.boards[index]),
      [],
      `${at}: a well-formed board (violations)`,
    );
    assertEqual(
      sweep.afterSolve[index].solvedCount,
      index + 1,
      `after solve ${index + 1}: solvedCount keeps rising by one`,
    );
  }
});
