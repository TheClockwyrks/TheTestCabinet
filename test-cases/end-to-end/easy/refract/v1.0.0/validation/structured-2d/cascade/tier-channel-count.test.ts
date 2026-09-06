// Refract — cascade/tier-channel-count: each tier emits the channel count its rung states.
//
// specs/modes/cascade.md "The tier ladder" gives one row per tier; this point
// reads the channel count off it. The generator is asked for five boards at every
// tier through `generateBoard` (specs/instrumentation.md), and each board is
// held, as it arrives, against the row of the tier it was asked for at.
// Whether the build's own `tier` field tracks the ladder is
// cascade/tier-ladder's point; here the subject is the boards. The still is
// the last tier-5 board, the fullest row.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  generateAtTiers,
  resetTo,
  type Harness,
} from "../harness";
import {
  CHANNELS,
  MAX_TIER,
  TIERS,
  channelsPresent,
  type Board,
} from "../notation";

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
  const present = channelsPresent(board);
  assertEqual(
    present.length,
    row.channels,
    `${context}: channels at tier ${tier}`,
  );
  assertDeepEqual(
    present,
    CHANNELS.slice(0, row.channels),
    `${context}: the first n of CHANNELS at tier ${tier}`,
  );
}

it("gives every board the channel count of the tier it was generated at, the first n of CHANNELS", async () => {
  await resetTo(h);
  await generateAtTiers(h, PER_TIER, ({ tier, round, board }) => {
    if (tier === MAX_TIER && round === PER_TIER) captureStill(h, "board");
    assertRung(board, tier, `tier ${tier}, board ${round}`);
  });
});
