// discharge/inert-blocks-reach — an inert node does not carry the chain.
//
// specs/discharge.md: an inert node "does not conduct: the chain leaps over it,
// and a charged node reachable only through an inert node is reached only if it
// lies within `DISCHARGE_RADIUS` of a node the chain detonated by another route."
//
// THE THREE NODES ARE A LINE SPACED AT THE REACH. The critical node is struck;
// `DISCHARGE_RADIUS` tiles along the row stands an INERT node, inside the blast
// but neither detonating nor conducting; `DISCHARGE_RADIUS` tiles past that
// stands a charged node, `2 * DISCHARGE_RADIUS` from the detonation and so
// outside its reach. The charged node's only route is through the inert one, and
// there is no other node on the board to give it a second one.
//
// THIS IS THE SAME GEOMETRY `chain-propagates` CLEARS END TO END, with the middle
// node's charge as the only difference — so the pair of points isolates
// conduction from reach exactly: a build that hops through anything standing
// clears the far node here and is named for it, and one that measures the reach
// wrongly is named by `chain-stops` instead.
//
// THE FAR NODE IS POSED AT CHARGE 2, not 1 and not 3. Two is the only value from
// which every wrong model reads differently: untouched is `2`, wrongly detonated
// leaves the tile EMPTY, an arc treated as a knock-down leaves `1`, and a build
// that energized it on the way past leaves `3`. Posed at `1` a knock-down and a
// clear would be hard to tell apart, and posed at `3` it would be critical and a
// different rule again.
//
// THE DISCHARGE IS GUARDED. A reading that "the shielded node still stands" means
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
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The tile the critical node stands on: clear of every edge and of the band. */
const STRUCK_C = 10;
const LINE_R = 6;

/** The inert node, inside the blast and on the only route to the far node. */
const SHIELD_C = STRUCK_C + DISCHARGE_RADIUS;

/** The charged node, `2 * DISCHARGE_RADIUS` out and reachable only through it. */
const SHIELDED_C = STRUCK_C + 2 * DISCHARGE_RADIUS;

/** Inert: the one charge specs/discharge.md says does not conduct. */
const INERT_CHARGE = 0;

/**
 * The charge the shielded node is posed at.
 *
 * `2` — the middle of the charged range specs/nodes.md fixes (`0` to
 * `CHARGE_MAX`, `3`) — so surviving, detonating, being knocked down and being
 * energized are four different readings.
 */
const SHIELDED_CHARGE = 2;

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

it("leaves a charged node standing when its only route is through an inert node", async () => {
  startPlaying(h);
  h.debug.setNode(STRUCK_C, LINE_R, CHARGE_MAX);
  h.debug.setNode(SHIELD_C, LINE_R, INERT_CHARGE);
  h.debug.setNode(SHIELDED_C, LINE_R, SHIELDED_CHARGE);
  poseBolt(h, STRUCK_C, LINE_R + 1);

  const swept = await h.until((s) => s.bolts.length === 0, {
    maxFrames: BOLT_SWEEP_TICKS,
  });
  captureStill(h, "blocked");

  assertTrue(
    swept.hit,
    "the bolt to resolve and leave flight within the sweep (specs/cursor.md)",
  );
  assertNull(
    chargeAt(swept.snapshot, STRUCK_C, LINE_R),
    "the struck tile to be empty, which is the scenario's precondition: a " +
      "discharge has to have fired for conduction to be read at all " +
      "(graded by discharge.critical-detonates)",
  );

  assertEqual(
    chargeAt(swept.snapshot, SHIELDED_C, LINE_R),
    SHIELDED_CHARGE,
    `the charge on the node at (${SHIELDED_C}, ${LINE_R}), Chebyshev ` +
      `${2 * DISCHARGE_RADIUS} from the detonation and reachable only through ` +
      `the inert node at (${SHIELD_C}, ${LINE_R})`,
  );
});
