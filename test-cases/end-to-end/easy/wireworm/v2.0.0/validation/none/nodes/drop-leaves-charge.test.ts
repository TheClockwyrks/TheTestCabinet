// nodes/drop-leaves-charge — a worm dropping onto a node leaves its charge alone.
//
// specs/nodes.md: "a worm dropping or diving into a tile a node stands on leaves
// that node's charge exactly as it was." specs/worm.md says the same from the
// worm's side: "Only a horizontal step can be blocked. The vertical move a block
// produces always takes the head into the tile at `(c, r + dv)`, whatever stands
// there. A node or a worm segment on that tile neither turns the worm nor is
// destroyed by it, and a node keeps the charge it had."
//
// WHY THE LANDING NODE IS POSED AT CHARGE 2. It is the only charge from which
// every wrong model reads back as a different number: charged on contact reads
// `3`, cleared reads `0`, replaced by a fresh inert node reads `0` as well,
// removed or detonated reads absent, and de-energized reads `1`. Posed at `0` a
// build that lays a fresh node would look right; posed at `3` a build that bumps
// would look right, because the cap hides it.
//
// THE BLOCK IS THE BOARD'S EDGE, NOT A NODE. The head stands on the last column
// heading right, so the step is blocked by the edge (specs/worm.md) and the drop
// follows — which leaves the LANDING node the only node on the whole board, and
// so the only node the check's reading can be about. A node used as the blocker
// would have to be charged by the block (nodes/bump-charges) and would sit one
// tile from the reading.
//
// WHAT IS ASSERTED, AND WHAT IS ONLY THE SCENARIO. The requirement is the CHARGE.
// The head's tile is read first, as the scenario this point needs to have
// happened at all — a check that never dropped would report an untouched charge
// and mean nothing by it. That the head enters the tile is
// worm/drop-passes-through-node's own requirement.
//
// NO TOLERANCE APPLIES: a charge is a whole number and the comparison is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { COLS } from "../constants";
import {
  captureStill,
  chargeAt,
  createHarness,
  driveSteps,
  headOf,
  poseWorm,
  requireWorm,
  startPlaying,
  type Harness,
} from "../harness";

/** The head's tile: the last column, so a rightward step runs into the edge. */
const HEAD = { c: COLS - 1, r: 8 } as const;

/** The tile the drop takes the head into: one row down, same column. */
const LANDING = { c: HEAD.c, r: HEAD.r + 1 } as const;

/** The landing node's charge: `2`, the value every wrong model reads apart from. */
const POSED_CHARGE = 2;

/** The drive: exactly the one step the block and its drop happen on. */
const STEPS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a charge-2 node at charge 2 when a worm drops onto it", async () => {
  await startPlaying(h);
  await h.debug.setNode(LANDING.c, LANDING.r, POSED_CHARGE);
  const id = await poseWorm(h, {
    c: HEAD.c,
    r: HEAD.r,
    length: 1,
    dh: 1,
    dv: 1,
  });
  assertEqual(
    chargeAt(await h.snapshot(), LANDING.c, LANDING.r),
    POSED_CHARGE,
    "the node as posed, before the drop",
  );

  await driveSteps(h, STEPS);
  await captureStill(h, "landed");

  const after = await h.snapshot();
  assertDeepEqual(
    headOf(requireWorm(after, id, "the drop this point poses")),
    { c: LANDING.c, r: LANDING.r },
    "the head's tile after the drop, which is the scenario this point needs",
  );
  assertEqual(
    chargeAt(after, LANDING.c, LANDING.r),
    POSED_CHARGE,
    `the node at (${LANDING.c}, ${LANDING.r}) the head dropped onto`,
  );
});
