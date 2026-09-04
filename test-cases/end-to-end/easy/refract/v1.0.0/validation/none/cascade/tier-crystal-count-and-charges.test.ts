// cascade/tier-crystal-count-and-charges — each tier crowds its crystals as its rung states.
//
// specs/modes/cascade.md's ladder table, held verbatim in notation.ts's TIERS:
// per tier, how many crystals a board carries and the charges each one gets. Each board of a twenty-five-board sweep is held to the row of the
// tier the run stood at when it was generated — read as the spec's own formula
// over the solvedCount the arrival snapshot reports, since "the generator draws
// each board's grid size from its tier's stated range" and the tier is
// recomputed from solvedCount alone. Whether the tier FIELD tracks the ladder is
// tier-ladder's point; here the subject is the boards.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertNotNull } from "../assert";
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

it("each board's crystal count and charges fall inside its tier's stated ranges", async () => {
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

    const crystals = board.nodes.filter((node) => node.kind === "crystal");
    assertBetween(
      crystals.length,
      row.crystals[0],
      row.crystals[1],
      `${at}: crystals`,
    );
    for (const crystal of crystals) {
      const where = `${at}: crystal at (${crystal.col}, ${crystal.row})`;
      assertNotNull(crystal.charges, `${where}: charges`);
      assertBetween(
        crystal.charges ?? 0,
        row.charges[0],
        row.charges[1],
        `${where}: charges`,
      );
    }
  }
});
