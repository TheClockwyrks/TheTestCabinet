// Wireworm — nodes/shared-tile-keeps-charge: a bolt into a segment standing on a
// node leaves that node's charge alone.
//
// specs/nodes.md, "What a bolt does to a node": "A bolt that resolves against a
// worm segment standing on a tile a node also occupies leaves that node's charge
// exactly as it was. The segment is what the bolt struck." And "How the field
// grows": "Where that tile already holds a node, no new node is laid and the
// standing node keeps the charge it had."
//
// A worm and a node share a tile because a drop or a dive passes through
// whatever stands below (specs/worm.md), so this is the state the board is
// genuinely left in and not a contrivance. The tail is posed onto the node
// directly, because the route that produced the overlap is
// `worm.drop-passes-through-node`'s requirement and this point must not decide it
// again.
//
// The worm is posed with BOTH FACULTIES OFF — no step and no body — so the tile
// the bolt resolves on is the tile the tail was posed on, and it carries three
// segments laid to the RIGHT of the tail, so the bolt's column holds the tail
// alone.
//
// The node is posed at charge `2`, which is the whole design of the point: `2` is
// the only value from which every wrong model reads as a different number. Left
// alone it reads `2`; struck as a node rather than as a segment it reads `1`;
// replaced by a fresh inert node it reads `0`; cleared it reads absent.
//
// THIS POINT ASSERTS THE CHARGE ALONE. That the worm shortens by the cut segment
// is `worm.shot-tail-shortens`'s requirement, so a build that fails the
// shortening is docked there and not twice.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, TILE } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  poseBoltAtTile,
  poseWormPath,
  startPlaying,
  type Harness,
} from "../harness";

/** The row the worm lies along: clear of the entry row and of the player band. */
const ROW = 12;

/** The tail's column, which is the node's tile and the column the bolt climbs. */
const TAIL_C = 10;

/** The worm, head first: the head to the right, the tail on the shared tile. */
const BODY = [
  { c: TAIL_C + 2, r: ROW },
  { c: TAIL_C + 1, r: ROW },
  { c: TAIL_C, r: ROW },
];

/** The tile the bolt starts on, directly below the tail's, climbing into it. */
const FROM_R = ROW + 1;

/** Charged: the one value from which every wrong answer reads differently. */
const POSED = 2;

/**
 * Seconds of flight run.
 *
 * A bolt climbs at `BOLT_SPEED` (`900` units per second, specs/cursor.md), so it
 * covers the half-tile from the centre of the tile below to the shared tile in
 * `TILE / 2 / BOLT_SPEED` (`0.018` s). Five times that is well past the strike
 * and still only three tiles of travel.
 */
const FLIGHT = (5 * (TILE / 2)) / BOLT_SPEED;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the charge-2 node under the struck tail at charge 2", async () => {
  startPlaying(h);
  h.debug.setNode(TAIL_C, ROW, POSED);

  const worm = poseWormPath(h, BODY, 1, 1);
  h.debug.setWormStepping(worm, false);
  h.debug.setWormBody(worm, false);

  poseBoltAtTile(h, TAIL_C, FROM_R);

  await h.advanceSeconds(FLIGHT);
  captureStill(h, "shared");

  assertEqual(
    chargeAt(h.snapshot(), TAIL_C, ROW),
    POSED,
    `the charge on tile (${TAIL_C}, ${ROW}), which the struck tail stood on`,
  );
});
