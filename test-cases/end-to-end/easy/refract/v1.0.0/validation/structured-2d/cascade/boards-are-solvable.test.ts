// Refract — cascade/boards-are-solvable: every generated board is solvable.
//
// specs/modes/cascade.md "The generator": every board the generator emits is
// solvable under the rules in specs/beams.md — a board reaches the player only
// when a set of beams satisfying every rule is known to exist for it. The
// check proves it the only honest way: twenty consecutive generated boards are
// SOLVED for real — snapshot the arrived board, run the spec-derived solver,
// trace the found beams through the build's own limits, assert the build
// agrees it is solved, take NEXT BOARD. Twenty boards crosses the whole ladder
// (tier 5 from the sixteenth solve, specs/modes/cascade.md) and proves four
// more at the top, so the sweep reaches MAX_TIER and continues there.
//
// RESIDUAL RISK, documented: the solver caps its node expansions as a runaway
// stop. A conformant generator could in principle emit a board the search
// cannot crack inside the cap; that failure names the cap so it is read for
// what it is rather than as proof of a dead end. Boards within 7x6 with 1-3
// channels resolve in milliseconds in practice.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureReplay,
  createHarness,
  solveGenerated,
  type Harness,
} from "../harness";
import { MAX_TIER, TIER_ADVANCE } from "../notation";

const SEED = 1;
const BOARDS = 20;
/** Sixteen solves put the ladder at MAX_TIER (min(floor(16/4)+1, 5) = 5). */
const FIRST_TOP_TIER_BOARD = TIER_ADVANCE * (MAX_TIER - 1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("solves twenty consecutive generated boards, reaching tier 5 and continuing there", async () => {
  // The whole sweep is the section: board after board arriving and solving.
  const solved = await captureReplay(h, "solve", () =>
    solveGenerated(h, BOARDS, SEED),
  );

  assertLength(solved, BOARDS, "boards solved by the sweep");
  for (let k = FIRST_TOP_TIER_BOARD; k < BOARDS; k += 1) {
    assertEqual(
      solved[k].arrival.tier,
      MAX_TIER,
      `board ${k + 1} is generated at MAX_TIER, so the sequence continued there`,
    );
  }
  assertEqual(
    h.snapshot().solvedCount,
    BOARDS,
    "the sweep's twenty solves are counted",
  );
});
