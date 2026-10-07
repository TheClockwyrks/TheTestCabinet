// discharge/chain-stops — a charged node beyond the reach survives.
//
// specs/discharge.md gives the chain one reach and no more: a detonating node
// arcs to the charged nodes "whose tile lies within `DISCHARGE_RADIUS` (`2`)
// tiles of the detonating node's tile", and the chain runs on only "until no
// charged node stands within reach of any node it detonated".
//
// THIS IS THE OUTSIDE DIRECTION OF THE REACH BOUNDARY, and it is its own point
// rather than half of `chain-reaches`, because a build that detonates the whole
// board and a build that detonates nothing would score the same on one paired
// point. The survivor stands at `DISCHARGE_RADIUS + 1` tiles along the row — one
// tile past the edge of the `5 x 5` block — so the reading turns on exactly one
// tile of reach.
//
// NOTHING CHARGED STANDS BETWEEN THE TWO, which is what the item requires: the
// only node besides the survivor is the one the bolt strikes, so the chain has no
// second route and cannot reach the survivor by propagating. What happens when it
// DOES have a second route is `chain-propagates`.
//
// THE SURVIVOR IS POSED AT CHARGE 1 so every wrong model reads as its own value:
// untouched is `1`, detonated leaves the tile EMPTY, and a build that treated the
// arc as a knock-down leaves `0`.
//
// THE DISCHARGE IS GUARDED. A reading that "the far node still stands" means
// nothing unless a discharge actually fired, so the struck tile is read first as
// the scenario's precondition. Whether a bolt into a critical node detonates it
// is `critical-detonates`'s requirement and is graded there; here it is only what
// makes this reading a reading.

import { afterEach, beforeEach, it } from "vitest";
import {
  BOARD_H,
  BOLT_SPEED,
  CHARGE_MAX,
  DISCHARGE_RADIUS,
} from "../constants";
import { assertEqual, assertNull, assertTrue } from "../assert";
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

/** One tile past the edge of the `5 x 5` block, along the struck node's row. */
const SURVIVOR_C = STRUCK_C + DISCHARGE_RADIUS + 1;
const SURVIVOR_R = STRUCK_R;

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

it("leaves a charged node three tiles from the detonation standing", async () => {
  startPlaying(h);
  h.debug.setNode(STRUCK_C, STRUCK_R, CHARGE_MAX);
  h.debug.setNode(SURVIVOR_C, SURVIVOR_R, CONDUCTING_CHARGE);
  poseBolt(h, STRUCK_C, STRUCK_R + 1);

  const swept = await h.until((s) => s.bolts.length === 0, {
    maxFrames: BOLT_SWEEP_TICKS,
  });
  captureStill(h, "survivor");

  assertTrue(
    swept.hit,
    "the bolt to resolve and leave flight within the sweep (specs/cursor.md)",
  );
  assertNull(
    chargeAt(swept.snapshot, STRUCK_C, STRUCK_R),
    "the struck tile to be empty, which is the scenario's precondition: a " +
      "discharge has to have fired for the reach to be read at all " +
      "(graded by discharge.critical-detonates)",
  );

  assertEqual(
    chargeAt(swept.snapshot, SURVIVOR_C, SURVIVOR_R),
    CONDUCTING_CHARGE,
    `the charge on the node at (${SURVIVOR_C}, ${SURVIVOR_R}), Chebyshev ` +
      `${DISCHARGE_RADIUS + 1} from the detonation and the only other node on ` +
      "the board",
  );
});
