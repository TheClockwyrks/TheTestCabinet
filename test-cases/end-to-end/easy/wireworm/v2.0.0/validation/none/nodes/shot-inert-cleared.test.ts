// nodes/shot-inert-cleared — a bolt into an inert node removes it.
//
// specs/nodes.md's table of what a bolt does to a node by charge gives charge
// `0` one outcome: "The node is removed and its tile is left empty." That is the
// bottom of the ladder a player clears a charged node down — knock the charge
// down a bolt at a time, and the last bolt takes the node away.
//
// THE POSE IS ONE NODE AND ONE BOLT. The board carries no worm, no foe and no
// other node, so nothing else can be what the bolt resolved against and no other
// node can be the one that vanished. The bolt is placed one row BELOW the node,
// on a tile holding nothing, and climbs the one tile into it through the build's
// own shot code (specs/cursor.md), so the resolution is the game's rather than
// the check's.
//
// The reading is the presence of a node on the tile, which is a yes or a no:
// `null` is the tile left empty, and any number is a node still standing. A build
// that de-energized instead reads `0`, one that detonated reads the same `null`
// as the rule wants — and that is fine, because a detonation of an INERT node is
// itself a violation the discharge points grade (specs/discharge.md: "inert nodes
// neither detonate nor conduct"), and the neighbouring witness below would move
// if a blast had run.
//
// NO TOLERANCE APPLIES: the tile either holds a node or it does not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  poseNodes,
  shootTile,
  startPlaying,
  type Harness,
} from "../harness";

/** The tile the shot node stands on: clear of the band, clear of the entry row. */
const TARGET = { c: 12, r: 10 } as const;

/** The node is posed INERT, the charge specs/nodes.md removes on a hit. */
const POSED_CHARGE = 0;

/**
 * A witness two tiles away, at charge `2`.
 *
 * It stands where a chain arc would reach if the build wrongly DETONATED the
 * inert node (specs/discharge.md arcs to every charged node within
 * DISCHARGE_RADIUS), so a build that reaches the right answer by the wrong route
 * is named here rather than passing.
 */
const WITNESS = { c: TARGET.c + 2, r: TARGET.r, charge: 2 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the tile empty when a bolt strikes an inert node", async () => {
  await startPlaying(h);
  await poseNodes(h, [
    [TARGET.c, TARGET.r, POSED_CHARGE],
    [WITNESS.c, WITNESS.r, WITNESS.charge],
  ]);

  await shootTile(h, TARGET.c, TARGET.r);
  await captureStill(h, "cleared");

  const after = await h.snapshot();
  assertEqual(
    chargeAt(after, TARGET.c, TARGET.r),
    null,
    `the tile (${TARGET.c}, ${TARGET.r}) the inert node stood on`,
  );
  assertEqual(
    chargeAt(after, WITNESS.c, WITNESS.r),
    WITNESS.charge,
    `the charged witness at (${WITNESS.c}, ${WITNESS.r})`,
  );
});
