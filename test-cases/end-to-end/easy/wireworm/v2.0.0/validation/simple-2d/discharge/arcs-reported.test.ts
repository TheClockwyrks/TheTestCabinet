// discharge/arcs-reported — the discharge reports one arc per conducted link.
//
// specs/discharge.md: "A discharge reports one arc for each link the chain
// conducted along: the ordered pair of tiles joined by one node detonating
// another. A chain that detonates `n` nodes therefore reports `n - 1` arcs, one
// for each node beyond the struck one, naming the tile that detonated it and the
// tile it stands on." And on their lifetime: "Every arc of a discharge is created
// at the moment the chain resolves and lasts `ARC_LIFE` (`0.32` s) of game time,
// after which it is gone. No arc is reported at any other time."
//
// THE CHAIN IS THREE NODES IN A LINE, SPACED AT THE REACH, so the link set is
// forced and there is exactly one answer: the struck node reaches the middle one
// and nothing else, and the middle one reaches the far one. Two links, and each
// names a DIFFERENT `from` — so a build that reported every arc as radiating from
// the struck node is named here, and one that reported an arc per detonated NODE
// rather than per link reports three and is named too. A denser cluster would
// leave the count right and the naming unreadable.
//
// WHAT IS ASSERTED IS THE LINK SET, NEVER THE DRAWN POLYLINE. specs/discharge.md
// leaves the lightning's shape to the build ("The color and the form of the
// lightning are yours"), and `presentation.arcs-drawn` is the only point that
// touches the drawing. The keys are compared as a SORTED set, because the order
// the roster holds them in is not something the specification fixes: what it
// fixes is which pairs conducted.
//
// THE SECOND READING IS THE LIFETIME, taken after `ARC_LIFE` of game time has
// passed, with one frame of margin so the boundary is crossed however a build
// orders creating and ageing inside the update it strikes on.
//
// THE WORLD IS THREE NODES AND A BOLT, and the bolt climbs the struck node's own
// column, which the rest of the line is not in.

import { afterEach, beforeEach, it } from "vitest";
import {
  ARC_LIFE,
  BOARD_H,
  BOLT_SPEED,
  CHARGE_MAX,
  DISCHARGE_RADIUS,
} from "../constants";
import { assertDeepEqual, assertLength, assertTrue } from "../assert";
import {
  arcKeys,
  captureStill,
  createHarness,
  poseBolt,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The tile the critical node stands on: the near end of the line. */
const STRUCK_C = 12;
const LINE_R = 6;

/** The middle node, inside the struck node's `5 x 5` block. */
const MIDDLE_C = STRUCK_C + DISCHARGE_RADIUS;

/** The far node, reachable only from the middle one. */
const FAR_C = STRUCK_C + 2 * DISCHARGE_RADIUS;

/** The lowest charge specs/discharge.md conducts through: "charge `1` or above". */
const CONDUCTING_CHARGE = 1;

/**
 * The two links the chain must report, as `"c,r>c,r"`, sorted.
 *
 * One per node beyond the struck one, each naming the tile that detonated it
 * first: three nodes detonate, so `n - 1` is two.
 */
const EXPECTED_ARCS = [
  `${STRUCK_C},${LINE_R}>${MIDDLE_C},${LINE_R}`,
  `${MIDDLE_C},${LINE_R}>${FAR_C},${LINE_R}`,
].sort();

/**
 * The most frames the bolt is given to resolve.
 *
 * specs/cursor.md flies a bolt straight up at `BOLT_SPEED` (`900` units per
 * second), so a bolt posed one tile below its target needs half a tile of climb.
 * The ceiling is the whole board's height at that speed (`640 / 900`), far past
 * what the strike needs and still bounded — and far short of `ARC_LIFE`, so the
 * arcs are still live when the sweep stops.
 */
const BOLT_SWEEP_TICKS = ticksFor(BOARD_H / BOLT_SPEED);

/**
 * Frames covering an arc's whole life, plus one.
 *
 * `ARC_LIFE` is `0.32` s, which is `38.4` frames of the 120 Hz clock and so `39`
 * rounded up. The extra frame is the margin: a build that ages its arcs before
 * creating them holds a full `0.32` s of life from the strike, and `40` frames is
 * `0.333` s, past it either way. Nothing turns on the exact frame — the reading
 * is that the arcs are gone once the life has run out.
 */
const ARC_LIFE_TICKS = ticksFor(ARC_LIFE) + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports one arc per conducted link, and none once ARC_LIFE has passed", async () => {
  startPlaying(h);
  h.debug.setNode(STRUCK_C, LINE_R, CHARGE_MAX);
  h.debug.setNode(MIDDLE_C, LINE_R, CONDUCTING_CHARGE);
  h.debug.setNode(FAR_C, LINE_R, CONDUCTING_CHARGE);
  poseBolt(h, STRUCK_C, LINE_R + 1);

  const swept = await h.until((s) => s.bolts.length === 0, {
    maxFrames: BOLT_SWEEP_TICKS,
  });
  captureStill(h, "arcs");

  assertTrue(
    swept.hit,
    "the bolt to resolve and leave flight within the sweep (specs/cursor.md)",
  );
  assertDeepEqual(
    arcKeys(swept.snapshot).sort(),
    EXPECTED_ARCS,
    "the links the chain reports, each as `from>to` in tile coordinates: one " +
      "per node beyond the struck one, naming the tile that detonated it",
  );

  await h.advance(ARC_LIFE_TICKS);
  assertLength(
    h.snapshot().arcs,
    0,
    `the arcs still reported ${ARC_LIFE_TICKS} frames after the discharge, ` +
      `which is past the ARC_LIFE of ${ARC_LIFE} s`,
  );
});
