// cascade/tier-channel-count — each tier emits the channel count its rung states.
//
// specs/modes/cascade.md's ladder table, held verbatim in notation.ts's TIERS:
// per tier, the number of channels a board carries. Each board of a twenty-five-board sweep is held to the row of the
// tier the run stood at when it was generated — read as the spec's own formula
// over the solvedCount the arrival snapshot reports, since "the generator draws
// each board's grid size from its tier's stated range" and the tier is
// recomputed from solvedCount alone. Whether the tier FIELD tracks the ladder is
// tier-ladder's point; here the subject is the boards.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  CHANNELS,
  TIERS,
  channelsPresent,
  tierForSolvedCount,
} from "../notation";
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

it("each board carries exactly its tier's channel count, the first n of CHANNELS", async () => {
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

    const present = channelsPresent(board);
    assertEqual(present.length, row.channels, `${at}: channels present`);
    assertDeepEqual(
      present,
      CHANNELS.slice(0, row.channels),
      `${at}: the first n of CHANNELS`,
    );
  }
});
