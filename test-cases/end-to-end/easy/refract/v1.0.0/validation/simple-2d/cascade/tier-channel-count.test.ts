// Refract — cascade/tier-channel-count: each tier emits the channel count its rung states.
//
// specs/modes/cascade.md "The tier ladder" gives one row per tier; this point
// reads the channel count off it. The generator is asked for five boards at every
// tier through `generateBoard` (specs/instrumentation.md), and each board is
// held, as it arrives, against the row of the tier it was asked for at.
// Whether the build's own `tier` field tracks the ladder is
// cascade/tier-ladder's point; here the subject is the boards. The oracle's
// TIERS table is the ladder as the spec states it, one entry per tier. The
// still is the last tier-5 board, the fullest row.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  generateAtTiers,
  resetTo,
  type Harness,
} from "../harness";
import { CHANNELS, MAX_TIER, TIERS, channelsPresent } from "../notation";

const PER_TIER = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives every board the channel count of the tier it was generated at, the first n of CHANNELS", async () => {
  await resetTo(h);

  await generateAtTiers(h, PER_TIER, ({ tier, round, board }) => {
    if (tier === MAX_TIER && round === PER_TIER) captureStill(h, "board");
    const spec = TIERS[tier - 1];
    const context = `tier ${tier}, board ${round}`;
    const present = channelsPresent(board);
    assertEqual(
      present.length,
      spec.channels,
      `${context}: the channel count the tier's row states`,
    );
    assertDeepEqual(
      present,
      CHANNELS.slice(0, spec.channels),
      `${context}: the first n of CHANNELS`,
    );
  });
});
