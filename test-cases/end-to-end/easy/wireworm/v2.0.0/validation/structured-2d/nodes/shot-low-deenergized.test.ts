// Wireworm — nodes/shot-low-deenergized: a bolt knocks a charge-1 node down one level.
//
// specs/nodes.md, "What a bolt does to a node": a bolt into a node at charge
// `1` leaves "the node left standing at charge `0`". A charged node is
// cleared "by knocking its charge down one bolt at a time and removing it once it
// is inert", and this point decides the one rung from `1` to `0`. Each other
// rung is its own point: `nodes.shot-mid-deenergized` for the neighbouring one,
// `nodes.shot-inert-cleared` for the removal at the bottom of the ramp, and
// `discharge.critical-detonates` for the detonation at the top.
//
// The node is posed alone on an otherwise empty board and the bolt is placed on
// the tile directly below it, climbing, so the shot resolves against the one
// thing the requirement is about. Nothing here fires: `addBolt` places a bolt the
// build's own shot rules then carry and resolve (specs/instrumentation.md), so
// what the cursor does is `cursor.*`'s requirement and not this one's.
//
// The reading tells every wrong model apart. A build that removed the node
// instead of de-energizing it reads absent, one that left the charge alone reads
// `1`, one that knocked it two levels reads below `0`, and one that raised
// it reads above.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, TILE } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  poseBoltAtTile,
  startPlaying,
  type Harness,
} from "../harness";

/** The node's tile: mid-board, clear of the entry row and of the player band. */
const NODE_C = 10;
const NODE_R = 12;

/** The tile the bolt starts on, directly below the node's, climbing into it. */
const FROM_R = NODE_R + 1;

/** The charge struck, which is the row of the table this point decides. */
const POSED = 1;

/** The charge the table leaves standing on the tile. */
const LEFT = 0;

/**
 * Seconds of flight run.
 *
 * A bolt climbs at `BOLT_SPEED` (`900` units per second, specs/cursor.md), so it
 * covers the half-tile from the centre of the tile below to the node's tile in
 * `TILE / 2 / BOLT_SPEED` (`0.018` s). Five times that is well past the strike
 * and still only three tiles of travel, so a build whose bolt resolved against
 * nothing has simply climbed the empty column above.
 */
const FLIGHT = (5 * (TILE / 2)) / BOLT_SPEED;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves a charge-0 node standing after a bolt into a charge-1 node", async () => {
  startPlaying(h);
  h.debug.setNode(NODE_C, NODE_R, POSED);
  poseBoltAtTile(h, NODE_C, FROM_R);

  await h.advanceSeconds(FLIGHT);
  captureStill(h, "deenergized");

  assertEqual(
    chargeAt(h.snapshot(), NODE_C, NODE_R),
    LEFT,
    `the charge on tile (${NODE_C}, ${NODE_R}) after the bolt`,
  );
});
