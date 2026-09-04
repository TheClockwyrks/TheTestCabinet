// cascade/tier-grid-range — each tier emits grids inside its stated range.
//
// specs/modes/cascade.md's ladder table, held verbatim in notation.ts's TIERS:
// per tier, the grid's cols x rows range, each drawn independently. Each board of a twenty-five-board sweep is held to the row of the
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

it("each board's cols and rows fall inside its tier's stated range", async () => {
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

    assertBetween(board.cols, row.cols[0], row.cols[1], `${at}: cols`);
    assertBetween(board.rows, row.rows[0], row.rows[1], `${at}: rows`);
  }
});
