// nodes/shot-low-deenergized — a bolt knocks a charge-1 node down to inert.
//
// specs/nodes.md's table of what a bolt does to a node by charge gives charge
// `1` one outcome: "The node is left standing at charge `0`." The node is NOT
// removed — that is what separates this rung of the ladder from
// nodes/shot-inert-cleared, and a build that clears on any hit fails here while
// passing there.
//
// THE POSE IS ONE NODE AND ONE BOLT. Nothing else stands on the board, so
// nothing else can be what the bolt resolved against. The bolt is placed one row
// below the node, on an empty tile, and climbs into it through the build's own
// shot code (specs/cursor.md).
//
// EVERY WRONG MODEL READS AS A DIFFERENT NUMBER: left alone reads `1`, removed
// reads absent, knocked two rungs reads absent as well but is caught by the rung
// above, and raised reads `2`.
//
// NO TOLERANCE APPLIES: a charge is a whole number and the comparison is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  shootTile,
  startPlaying,
  type Harness,
} from "../harness";

/** The tile the shot node stands on: clear of the band, clear of the entry row. */
const TARGET = { c: 12, r: 10 } as const;

/** The node is posed at charge `1`, the "low" state of specs/nodes.md's table. */
const POSED_CHARGE = 1;

/** What one bolt leaves it at, from the same table. */
const STRUCK_CHARGE = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a charge-1 node standing at charge 0 when a bolt strikes it", async () => {
  await startPlaying(h);
  await h.debug.setNode(TARGET.c, TARGET.r, POSED_CHARGE);
  assertEqual(
    chargeAt(await h.snapshot(), TARGET.c, TARGET.r),
    POSED_CHARGE,
    "the node as posed, before the bolt",
  );

  await shootTile(h, TARGET.c, TARGET.r);
  await captureStill(h, "deenergized");

  assertEqual(
    chargeAt(await h.snapshot(), TARGET.c, TARGET.r),
    STRUCK_CHARGE,
    `the node at (${TARGET.c}, ${TARGET.r}) after one bolt`,
  );
});
