// Refract — cascade/tier-crystal-count-and-charges: each tier crowds its crystals as its rung states.
//
// specs/modes/cascade.md "The tier ladder" gives one row per tier; this point
// reads the crystal count and charge ranges off it. The generator is asked for five boards at every
// tier through `generateBoard` (specs/instrumentation.md), and each board is
// held, as it arrives, against the row of the tier it was asked for at.
// Whether the build's own `tier` field tracks the ladder is
// cascade/tier-ladder's point; here the subject is the boards. The still is
// the last tier-5 board, the fullest row.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  generateAtTiers,
  resetTo,
  type Harness,
} from "../harness";
import { MAX_TIER, TIERS, type Board } from "../notation";

const PER_TIER = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Hold one arrived board against its rung's row of the ladder. */
function assertRung(board: Board, tier: number, context: string): void {
  const row = TIERS[tier - 1];
  const crystals = board.nodes.filter((node) => node.kind === "crystal");
  assertBetween(
    crystals.length,
    row.crystals[0],
    row.crystals[1],
    `${context}: crystals at tier ${tier}`,
  );
  for (const crystal of crystals) {
    assertNotNull(
      crystal.charges,
      `${context}: a crystal at (${crystal.col}, ${crystal.row}) carries charges`,
    );
    assertBetween(
      crystal.charges as number,
      row.charges[0],
      row.charges[1],
      `${context}: charges at (${crystal.col}, ${crystal.row}) at tier ${tier}`,
    );
  }
}

it("gives every board the crystal count and charge range of the tier it was generated at", async () => {
  await resetTo(h);
  await generateAtTiers(h, PER_TIER, ({ tier, round, board }) => {
    if (tier === MAX_TIER && round === PER_TIER) captureStill(h, "board");
    assertRung(board, tier, `tier ${tier}, board ${round}`);
  });
});
