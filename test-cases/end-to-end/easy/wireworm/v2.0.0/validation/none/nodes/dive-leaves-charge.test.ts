// nodes/dive-leaves-charge — a dive leaves the charges it passes through alone.
//
// specs/nodes.md: "a worm dropping or diving into a tile a node stands on leaves
// that node's charge exactly as it was." specs/worm.md says it again of the dive
// in particular: "While a worm is diving, each step advances the head one tile
// down its own column, to `(c, r + 1)`, whatever stands on the tile it enters.
// The tile's node or segment is left exactly as it was, and neither turns the
// worm nor is destroyed."
//
// WHY THE COLUMN IS POSED AT CHARGE 2. It is the only charge from which every
// wrong model reads back as a different number: charged on contact reads `3`,
// cleared reads `0`, replaced by a fresh inert node reads `0` as well, eaten or
// detonated reads absent, and de-energized reads `1`. Three tiles in a row are
// read rather than one, because the rule is about the whole passage and a build
// that spares the first tile and charges the rest is named for the tile it moved.
//
// THE DIVE IS POSED, NOT ENTERED. `setWormDiving` (specs/instrumentation.md) puts
// the worm in the state this point is about, so the check reaches its scenario
// directly and no critical node has to stand on the board to start one. What
// starts a dive is worm/dive-enters's requirement, and none of it is in here: the
// worm carries a head alone, and the only nodes on the board are the three the
// head passes through.
//
// WHAT IS ASSERTED, AND WHAT IS ONLY THE SCENARIO. The requirement is the three
// CHARGES. The head's tile is read first, as the scenario this point needs to
// have happened at all — a check whose head never travelled the column would
// report three untouched charges and mean nothing by it. That the head advances
// through them is worm/dive-passes-through-node's own requirement.
//
// NO TOLERANCE APPLIES: a charge is a whole number and the comparison is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  driveSteps,
  headOf,
  poseNodes,
  poseWorm,
  requireWorm,
  startPlaying,
  type Harness,
} from "../harness";

/** The diving head's tile: high enough that three steps stay above the band. */
const HEAD = { c: 10, r: 8 } as const;

/** The charged column beneath it, the tiles the dive passes down through. */
const COLUMN: readonly { c: number; r: number }[] = [
  { c: HEAD.c, r: HEAD.r + 1 },
  { c: HEAD.c, r: HEAD.r + 2 },
  { c: HEAD.c, r: HEAD.r + 3 },
];

/** Each is posed at `2`, the charge every wrong model reads apart from. */
const POSED_CHARGE = 2;

/** The drive: one step per tile of the column, and no further. */
const STEPS = COLUMN.length;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves every charge-2 node a dive passes down through at charge 2", async () => {
  await startPlaying(h);
  await poseNodes(
    h,
    COLUMN.map((tile) => [tile.c, tile.r, POSED_CHARGE] as const),
  );
  const id = await poseWorm(h, {
    c: HEAD.c,
    r: HEAD.r,
    length: 1,
    dh: 1,
    dv: 1,
    diving: true,
  });
  for (const tile of COLUMN) {
    assertEqual(
      chargeAt(await h.snapshot(), tile.c, tile.r),
      POSED_CHARGE,
      `the node at (${tile.c}, ${tile.r}) as posed, before the dive`,
    );
  }

  await driveSteps(h, STEPS);
  await captureStill(h, "dived");

  const after = await h.snapshot();
  const last = COLUMN[COLUMN.length - 1];
  assertDeepEqual(
    headOf(requireWorm(after, id, "the dive this point poses")),
    { c: last.c, r: last.r },
    "the head's tile after the dive, which is the scenario this point needs",
  );
  for (const tile of COLUMN) {
    assertEqual(
      chargeAt(after, tile.c, tile.r),
      POSED_CHARGE,
      `the node at (${tile.c}, ${tile.r}) the dive passed down through`,
    );
  }
});
