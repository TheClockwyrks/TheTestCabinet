// nodes/shared-tile-keeps-charge — a bolt into a shared tile spares the charge.
//
// specs/nodes.md states it twice, once from each side. Of what a bolt does: "A
// bolt that resolves against a worm segment standing on a tile a node also
// occupies leaves that node's charge exactly as it was. The segment is what the
// bolt struck." And of how the field grows: "Where that tile already holds a
// node, no new node is laid and the standing node keeps the charge it had."
// specs/cursor.md settles which of the two the bolt resolves against: "Where a
// worm segment and a node share a tile, the bolt resolves against the segment."
//
// WHY THE SHARED NODE IS POSED AT CHARGE 2. It is the only charge from which the
// four answers a build can give read back as four different numbers: left alone
// reads `2`, replaced by the fresh inert node a shot-killed segment lays reads
// `0`, de-energized as though the bolt had struck the NODE reads `1`, and
// removed or detonated reads absent. Posed at `0` the fresh-node bug is
// invisible; posed at `3` a build that struck the node would detonate and look
// like a removal.
//
// THIS POINT ASSERTS THE CHARGE ALONE. The tail also goes, and the chain also
// shortens, but that is worm/shot-tail-shortens's requirement: a build that
// fails the shortening is docked there, and docking it twice would make one
// mistake read as two. Nothing here reads the worm.
//
// THE WORM IS A TARGET AND NOTHING ELSE. Two segments with the step faculty off
// (specs/instrumentation.md's `setWormStepping`), so the chain holds its tiles
// through the flight and the tile struck is the tile the node stands on. The bolt
// is placed one row below, on an empty tile, and climbs into the shared tile
// through the build's own shot code.
//
// NO TOLERANCE APPLIES: a charge is a whole number and the comparison is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  poseWorm,
  shootTile,
  startPlaying,
  type Harness,
} from "../harness";

/** The head's tile, and with it the chain: the tail sits one column to its left. */
const HEAD = { c: 13, r: 10 } as const;

/** The shared tile: the tail stands on it, and so does the node. */
const SHARED = { c: HEAD.c - 1, r: HEAD.r } as const;

/** The node's charge: `2`, the value every wrong model reads apart from. */
const POSED_CHARGE = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the charge-2 node under a shot tail at charge 2", async () => {
  await startPlaying(h);
  await h.debug.setNode(SHARED.c, SHARED.r, POSED_CHARGE);
  await poseWorm(h, {
    c: HEAD.c,
    r: HEAD.r,
    length: 2,
    dh: 1,
    dv: 1,
    stepping: false,
  });
  assertEqual(
    chargeAt(await h.snapshot(), SHARED.c, SHARED.r),
    POSED_CHARGE,
    "the node as posed, under the tail and before the bolt",
  );

  await shootTile(h, SHARED.c, SHARED.r);
  await captureStill(h, "shared");

  assertEqual(
    chargeAt(await h.snapshot(), SHARED.c, SHARED.r),
    POSED_CHARGE,
    `the node at (${SHARED.c}, ${SHARED.r}), which the tail stood on`,
  );
});
