// discharge/chain-reaches — the chain reaches a charged node two tiles away.
//
// specs/discharge.md: "A node that detonates arcs to every node at charge `1` or
// above that is standing at that moment and whose tile lies within
// `DISCHARGE_RADIUS` (`2`) tiles of the detonating node's tile, measured as a
// Chebyshev distance: the `5 x 5` block of tiles centered on the detonating node.
// Each of those nodes is itself detonated."
//
// THE NEIGHBOUR IS ON THE DIAGONAL, at `(+DISCHARGE_RADIUS, -DISCHARGE_RADIUS)`
// from the struck node. That is the corner of the `5 x 5` block: Chebyshev `2`
// but Euclidean `2.83` and Manhattan `4`, so a build that measured the reach as a
// circle or as a Manhattan walk leaves the node standing and is named here, while
// a build measuring Chebyshev clears it. This is the INSIDE direction of the
// reach boundary; `chain-stops` is the outside one, and they are two points
// because a build that detonates the whole board and a build that detonates
// nothing would score the same on one paired point.
//
// THE NEIGHBOUR IS POSED AT CHARGE 1, the lowest charge that conducts, so the
// reading separates the wrong models: detonated leaves the tile EMPTY, a chain
// that never reached it leaves `1`, and a build that treated the arc as a
// knock-down leaves `0`.
//
// THE WORLD IS TWO NODES AND A BOLT. Nothing else stands on the board, so the
// neighbour's tile can only have been emptied by the chain, and the bolt climbs a
// column the neighbour is not in.

import { afterEach, beforeEach, it } from "vitest";
import {
  BOARD_H,
  BOLT_SPEED,
  CHARGE_MAX,
  DISCHARGE_RADIUS,
} from "../../src/constants";
import { assertNull, assertTrue } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  poseBolt,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The tile the critical node stands on: clear of every edge and of the band. */
const STRUCK_C = 12;
const STRUCK_R = 6;

/** The diagonal corner of the `5 x 5` block, exactly `DISCHARGE_RADIUS` away. */
const NEIGHBOUR_C = STRUCK_C + DISCHARGE_RADIUS;
const NEIGHBOUR_R = STRUCK_R - DISCHARGE_RADIUS;

/** The lowest charge specs/discharge.md conducts through: "charge `1` or above". */
const CONDUCTING_CHARGE = 1;

/**
 * The most frames the bolt is given to resolve.
 *
 * specs/cursor.md flies a bolt straight up at `BOLT_SPEED` (`900` units per
 * second), so a bolt posed one tile below its target needs half a tile of climb.
 * The ceiling is the whole board's height at that speed (`640 / 900`), far past
 * what the strike needs and still bounded.
 */
const BOLT_SWEEP_TICKS = ticksFor(BOARD_H / BOLT_SPEED);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("detonates a charged node two tiles away on the diagonal", async () => {
  startPlaying(h);
  h.debug.setNode(STRUCK_C, STRUCK_R, CHARGE_MAX);
  h.debug.setNode(NEIGHBOUR_C, NEIGHBOUR_R, CONDUCTING_CHARGE);
  poseBolt(h, STRUCK_C, STRUCK_R + 1);

  const swept = await h.until((s) => s.bolts.length === 0, {
    maxFrames: BOLT_SWEEP_TICKS,
  });
  captureStill(h, "reached");

  assertTrue(
    swept.hit,
    "the bolt to resolve and leave flight within the sweep (specs/cursor.md)",
  );
  assertNull(
    chargeAt(swept.snapshot, NEIGHBOUR_C, NEIGHBOUR_R),
    `the node at (${NEIGHBOUR_C}, ${NEIGHBOUR_R}), Chebyshev ` +
      `${DISCHARGE_RADIUS} from the detonation: a node the chain reaches is ` +
      "itself detonated, so its tile is left empty",
  );
});
