// hunter/removed-on-bay-fill — a completed crossing clears the hunt.
//
// specs/bays.md: "A crossing ends on the hop that lands the critter in an open
// bay, which is a hop up from row `2`. On that hop: ... every bear on the strait is
// removed, as `specs/hunter.md` fixes." specs/hunter.md says the same from the
// hunt's side: a crossing ending in a bay takes every bear off the strait.
//
// TWO BEARS, because the rule is "every bear" and a build that clears one slot
// rather than the roster passes with one. They are posed with `addBear` and the
// emergence gate is left SHUT, for the reason `removed-on-death` gives: what a
// crossing's end clears is the strait, and none of that is the emergence faculty.
//
// THE BAY IS ENTERED BY A REAL HOP, because that is the event the rule names: a
// posed bay is a bay that was never entered (`specs/bays.md` makes a level clear
// follow from the hop and from no other event), so a pose would grade nothing. The
// critter is put on row 2 in the middle bay's left column, on a parked raft, so it
// has floe footing to hop from rather than drowning on the tick before it jumps.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { BAYS, WATER_TOP } from "../../src/constants";
import {
  captureReplay,
  createHarness,
  hop,
  poseBear,
  poseLane,
  startCrossing,
  type Harness,
} from "../harness";

/** Two bears, well apart, on rows an emptied strait leaves bare. */
const BEARS = [
  { col: 8, row: 15 },
  { col: 30, row: 12 },
] as const;

/** The bay hopped into, and the column of row 2 the hop is taken from. */
const BAY_INDEX = 2;
const LAUNCH_COL = BAYS[BAY_INDEX][0];

/** The raft under the launch column, laid so its span covers that column. */
const RAFT_COL = LAUNCH_COL - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves the roster empty on the hop that ends a crossing in a bay", async () => {
  startCrossing(h);
  const frozen = { sense: false, routing: false, travel: false } as const;
  for (const at of BEARS) poseBear(h, at.col, at.row, frozen);

  poseLane(h, WATER_TOP, "raft3", [RAFT_COL]);
  h.debug.setCritterTile(LAUNCH_COL, WATER_TOP);

  // The scenario this check needs: BOTH bears really on the strait, because what
  // the rule says is "every bear"; and the bay the hop is aimed at really open,
  // because a hop into a filled bay ends no crossing (specs/bays.md).
  const posed = h.snapshot();
  assertLength(
    posed.bears,
    BEARS.length,
    "the bears posed on the strait before the crossing is completed",
  );
  assertEqual(
    posed.bays[BAY_INDEX],
    false,
    `bay ${BAY_INDEX}, which the hop below is aimed into`,
  );

  const after = await captureReplay(h, "reset", async () => {
    await hop(h, "up");
    return h.snapshot();
  });

  // The hop really did complete the crossing, so what emptied the roster is the
  // event the rule names rather than anything else.
  assertEqual(
    after.bays[BAY_INDEX],
    true,
    `bay ${BAY_INDEX} after the hop up from (${LAUNCH_COL}, ${WATER_TOP}), ` +
      `which is what a completed crossing fills (specs/bays.md)`,
  );
  assertLength(
    after.bears,
    0,
    `the hunt after a hop from (${LAUNCH_COL}, ${WATER_TOP}) into bay ` +
      `${BAY_INDEX}, ${BEARS.length} bears having been on the strait`,
  );
});
