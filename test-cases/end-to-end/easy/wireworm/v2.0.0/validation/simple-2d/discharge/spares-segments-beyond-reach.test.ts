// discharge/spares-segments-beyond-reach — a segment beyond the reach stands.
//
// specs/discharge.md: "A segment further than that from every detonated node is
// untouched and stays on its tile."
//
// THE SEGMENT SITS ONE TILE PAST THE REACH, `DISCHARGE_RADIUS + 1` along the row
// from the only node the discharge detonates, so the reading turns on exactly one
// tile. This is the outside direction of the boundary `fries-segments-in-reach`
// reads from the inside, and they are two points because a build that fries the
// whole board and a build that fries nothing would score the same on one paired
// point.
//
// ONE NODE DETONATES AND NO MORE. The struck node is the only node on the board,
// so "further than that from EVERY detonated node" is a distance to one tile and
// the check cannot be decided by where a chain went. What a chain does to the
// reach is `chain-propagates`'s requirement.
//
// THE WORM IS POSED AS A TARGET AND NOTHING ELSE. One segment, so no body
// follows; its STEP faculty is off, so it holds its tile instead of winding —
// which is what makes "still on its tile" a reading about the discharge rather
// than about the worm's cadence.
//
// THE DISCHARGE IS GUARDED. A reading that "the far segment still stands" means
// nothing unless a discharge actually fired, so the struck tile is read first as
// the scenario's precondition; `critical-detonates` is what grades that rule.

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
  poseWorm,
  segmentAt,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The tile the critical node stands on: clear of every edge and of the band. */
const STRUCK_C = 12;
const STRUCK_R = 6;

/** The segment's tile, one tile past the reach along the row. */
const SEGMENT_C = STRUCK_C + DISCHARGE_RADIUS + 1;
const SEGMENT_R = STRUCK_R;

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

it("leaves a worm segment three tiles from the detonation on its tile", async () => {
  startPlaying(h);
  h.debug.setNode(STRUCK_C, STRUCK_R, CHARGE_MAX);
  const worm = poseWorm(h, SEGMENT_C, SEGMENT_R, 1);
  h.debug.setWormStepping(worm, false);
  poseBolt(h, STRUCK_C, STRUCK_R + 1);

  const swept = await h.until((s) => s.bolts.length === 0, {
    maxFrames: BOLT_SWEEP_TICKS,
  });
  captureStill(h, "spared");

  assertTrue(
    swept.hit,
    "the bolt to resolve and leave flight within the sweep (specs/cursor.md)",
  );
  assertNull(
    chargeAt(swept.snapshot, STRUCK_C, STRUCK_R),
    "the struck tile to be empty, which is the scenario's precondition: a " +
      "discharge has to have fired for its reach into the worm to be read at " +
      "all (graded by discharge.critical-detonates)",
  );

  assertEqual(
    segmentAt(swept.snapshot, SEGMENT_C, SEGMENT_R),
    true,
    `whether the worm segment still stands on (${SEGMENT_C}, ${SEGMENT_R}), ` +
      `Chebyshev ${DISCHARGE_RADIUS + 1} from the only detonated node`,
  );
});
