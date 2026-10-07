// Wireworm — nodes/shot-inert-cleared: a bolt into an inert node removes it.
//
// specs/nodes.md, "What a bolt does to a node": a bolt into a node at charge `0`
// removes it "and its tile is left empty". That is the bottom of the ramp, and
// the point that separates de-energizing from clearing: the two charged rows of
// that table are `nodes.shot-low-deenergized` and `nodes.shot-mid-deenergized`,
// and the critical row belongs to `discharge.critical-detonates`.
//
// The node is posed alone on an otherwise empty board and the bolt is placed on
// the tile directly below it, climbing, so the shot resolves against the one
// thing the requirement is about and travels through nothing else on the way.
// Nothing here fires: `addBolt` places a bolt the build's own shot rules then
// carry and resolve (specs/instrumentation.md), so what the cursor does is
// `cursor.*`'s requirement and not this one's.
//
// The reading tells every wrong model apart, because an empty tile and an inert
// node are different states of the field: a build that left the node standing
// reads `0`, one that de-energized below inert reads a negative charge, one that
// raised it reads `1`, and only a build that removed it reads absent.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, TILE } from "../constants";
import { assertNull } from "../assert";
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

/** Inert: the charge this row of the table is about. */
const POSED = 0;

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

it("leaves the tile empty after a bolt into an inert node", async () => {
  startPlaying(h);
  h.debug.setNode(NODE_C, NODE_R, POSED);
  poseBoltAtTile(h, NODE_C, FROM_R);

  await h.advanceSeconds(FLIGHT);
  captureStill(h, "cleared");

  assertNull(
    chargeAt(h.snapshot(), NODE_C, NODE_R),
    `the charge on tile (${NODE_C}, ${NODE_R}), which the bolt should have left empty`,
  );
});
