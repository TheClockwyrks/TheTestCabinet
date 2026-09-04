// Refract — cascade/tier-channel-count: each tier emits the channel count its rung states.
//
// specs/modes/cascade.md "The tier ladder" gives one row per tier; this point
// reads the channel count off it. The sweep really solves
// twenty-five boards and holds each board, as it arrives, against the row for
// the tier it was generated at — read as the SPEC'S OWN FORMULA over the
// arrival snapshot's solvedCount. Reading the build's own `tier` field instead
// would let a build that mis-reports the rung be judged against the rung it
// claims; whether that field tracks the ladder is cascade/tier-ladder's point,
// and here the subject is the boards. Twenty-five boards visit every rung: five
// at each of tiers 1..5. The oracle's TIERS table is the ladder as the spec
// states it, one entry per tier. The still is a tier-5 board, the fullest row.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  oracleBoard,
  resetTo,
  startCascade,
  type Harness,
} from "../harness";
import {
  CHANNELS,
  TIERS,
  channelsPresent,
  tierForSolvedCount,
} from "../notation";
import { sweepGenerated } from "./sweep";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives every board its tier's channel count, the first n of CHANNELS", async () => {
  await resetTo(h, 1);
  await startCascade(h);

  await sweepGenerated(h, 25, {
    onBoard: (snapshot, round) => {
      if (round === 21) captureStill(h, "board");
      const tier = tierForSolvedCount(snapshot.solvedCount);
      const spec = TIERS[tier - 1];
      if (spec === undefined) {
        return fail(
          `a tier 1..${TIERS.length} on the ladder (specs/modes/cascade.md)`,
          tier,
        );
      }
      const context = `board ${round}, generated at tier ${spec.tier}`;
      const board = oracleBoard(snapshot);
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
    },
  });
});
