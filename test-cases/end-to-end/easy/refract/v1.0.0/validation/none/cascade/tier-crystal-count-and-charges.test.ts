// cascade/tier-crystal-count-and-charges — each tier crowds its crystals as its rung states.
//
// specs/modes/cascade.md's ladder table, held verbatim in notation.ts's TIERS:
// per tier, how many crystals a board carries and the charges each one gets.
// The generator is asked for five boards at every tier through `generateBoard`
// (specs/instrumentation.md), and each board is held to the row of the tier it
// was asked for at. Whether the tier FIELD tracks the ladder is tier-ladder's
// point; here the subject is the boards.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertNotNull } from "../assert";
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

it("each board's crystal count and charges fall inside the stated ranges of the tier it was generated at", async () => {
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
