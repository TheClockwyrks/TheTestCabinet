// cascade/tier-empty-cells — each tier leaves at most the empty cells its rung allows.
//
// specs/modes/cascade.md's ladder table, held verbatim in notation.ts's TIERS:
// per tier, the most cells a board may leave empty. Each board of a twenty-five-board sweep is held to the row of the
// tier the run stood at when it was generated — read as the spec's own formula
// over the solvedCount the arrival snapshot reports, since "the generator draws
// each board's grid size from its tier's stated range" and the tier is
// recomputed from solvedCount alone. Whether the tier FIELD tracks the ladder is
// tier-ladder's point; here the subject is the boards.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween } from "../assert";
import { TIERS, tierForSolvedCount } from "../notation";
import {
  captureStill,
  createHarness,
  solveGenerated,
  type Harness,
  type RefractSnapshot,
} from "../harness";

const SWEEP = 25;
const SEED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("each board leaves at most its tier's stated count of cells empty", async () => {
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

  for (const [index, board] of sweep.boards.entries()) {
    const tier = tierForSolvedCount(arrivals[index].solvedCount);
    const row = TIERS[tier - 1];
    const at = `board ${index + 1} (tier ${tier})`;

    assertBetween(
      board.cols * board.rows - board.nodes.length,
      0,
      row.emptyCells,
      `${at}: empty cells`,
    );
  }
});
