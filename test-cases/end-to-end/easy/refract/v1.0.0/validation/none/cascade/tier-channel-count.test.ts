// cascade/tier-channel-count — each tier emits the channel count its rung states.
//
// specs/modes/cascade.md's ladder table, held verbatim in notation.ts's TIERS:
// per tier, the number of channels a board carries. The generator is asked for
// five boards at every tier through `generateBoard` (specs/instrumentation.md),
// and each board is held to the row of the tier it was asked for at. Whether
// the tier FIELD tracks the ladder is tier-ladder's point; here the subject is
// the boards.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { CHANNELS, MAX_TIER, TIERS, channelsPresent } from "../notation";
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

it("each board carries exactly the channel count of the tier it was generated at, the first n of CHANNELS", async () => {
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

    const present = channelsPresent(board);
    assertEqual(present.length, row.channels, `${at}: channels present`);
    assertDeepEqual(
      present,
      CHANNELS.slice(0, row.channels),
      `${at}: the first n of CHANNELS`,
    );
  }
});
