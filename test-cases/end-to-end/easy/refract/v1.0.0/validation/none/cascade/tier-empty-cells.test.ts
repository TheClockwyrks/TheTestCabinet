// cascade/tier-empty-cells — each tier leaves at most the empty cells its rung allows.
//
// specs/modes/cascade.md's ladder table, held verbatim in notation.ts's TIERS:
// per tier, the most cells a board may leave empty. The generator is asked for
// five boards at every tier through `generateBoard` (specs/instrumentation.md),
// and each board is held to the row of the tier it was asked for at. Whether
// the tier FIELD tracks the ladder is tier-ladder's point; here the subject is
// the boards.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween } from "../assert";
import { MAX_TIER, TIERS } from "../notation";
import {
  captureStill,
  createHarness,
  generateAtTiers,
  type Harness,
} from "../harness";

const PER_TIER = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("each board leaves at most the stated count of cells empty for the tier it was generated at", async () => {
  const generated = await generateAtTiers(
    h,
    PER_TIER,
    async ({ tier, round }) => {
      if (tier === MAX_TIER && round === PER_TIER)
        await captureStill(h, "board");
    },
  );

  for (const { tier, round, board } of generated) {
    const row = TIERS[tier - 1];
    const at = `tier ${tier}, board ${round}`;

    assertBetween(
      board.cols * board.rows - board.nodes.length,
      0,
      row.emptyCells,
      `${at}: empty cells`,
    );
  }
});
