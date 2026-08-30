// presentation/arcs-drawn — a discharge draws lightning between the tiles it
// links.
//
// specs/discharge.md, on drawing an arc: "An arc is drawn as bright lightning
// joining the centers of the two tiles it links, so a player reads which node set
// off which." That sentence names one thing a script can decide — that something
// bright runs BETWEEN the two centres — and, in its next breath, several it
// cannot: "The color and the form of the lightning are yours." So the polyline
// itself is reviewed and not asserted, and what is asserted here is that the
// corridor joining each linked pair carries drawing all the way along it.
//
// EVERY LINK THE SNAPSHOT REPORTS IS READ, and the two the scenario produces are
// deliberately different shapes — one along a row, one on the diagonal — so a
// build that drew only the axis-aligned case is named. Which links a discharge
// conducts along is discharge/arcs-reported's requirement, not this point's: the
// links are read from the snapshot and taken as given, so a build that got the
// chain wrong is docked once, there.
//
// THE CORRIDOR IS A TILE WIDE. specs/discharge.md fixes the two ENDS of an arc
// and leaves its form free, so lightning is expected to wander off the straight
// line between them; half a tile of clearance on each side is room for that
// wandering and still narrow enough that only drawing that runs BETWEEN the two
// centres can satisfy it. Every sample point along the corridor has to find
// something, so a build that drew a spark at each end and nothing between them
// fails.
//
// THE BOARD IS BARE WHERE THE ARCS ARE. Both detonated nodes are removed by the
// chain — specs/discharge.md: "A detonated node is removed from the board, and
// its tile is left empty" — and the bolt is spent, so the only thing standing
// between the two centres is the lightning. The ground the corridor is held
// against is read off a bare tile of the same board.

import { afterEach, beforeEach, it } from "vitest";
import {
  BOARD_H,
  BOLT_SPEED,
  CHARGE_MAX,
  DISCHARGE_RADIUS,
  TILE,
  tileCX,
  tileCY,
} from "../../src/constants";
import { assertTrue, fail } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  poseBolt,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { meanColor, pixelColor, tileBox } from "./reading";

/**
 * How far the lightning must read from the board, in RGB distance on the 0–441
 * scale.
 *
 * `441` is the whole scale, `sqrt(3) * 255`. specs/discharge.md calls an arc
 * "bright lightning" and fixes no colour, so the bar is what a measurement can
 * honestly call a different colour rather than a shade of the same one: 40 is
 * under a tenth of the scale. It is the figure every colour point in this group
 * is set at.
 */
const APART_MIN = 40;

/**
 * How far to either side of the straight line between two centres the lightning
 * may wander, in logical units.
 *
 * specs/discharge.md fixes the two ENDS of an arc and leaves its form to the
 * build — "The color and the form of the lightning are yours" — so a jagged
 * polyline is expected to leave the straight line. Half a tile (`TILE / 2`, `16`)
 * is generous room for that and still keeps the corridor inside the pair of tiles
 * the arc joins.
 */
const CORRIDOR_HALF = TILE / 2;

/**
 * How many points along each arc are looked at, both ends included.
 *
 * Nine points over an arc that spans at most `2 * DISCHARGE_RADIUS` (`4`) tiles
 * puts a sample every half tile at the widest, so a gap in the drawing wider than
 * half a tile cannot hide between two of them.
 */
const SAMPLES_ALONG = 9;

/** The tile the critical node stands on, and the row it is on. */
const STRUCK_C = 12;
const STRUCK_R = 6;

/** The lowest charge specs/discharge.md conducts through: "charge 1 or above". */
const CONDUCTING_CHARGE = 1;

/** The tile the board itself is read off: bare, and well clear of the chain. */
const BARE_C = 30;
const BARE_R = 14;

/**
 * The most frames the bolt is given to resolve.
 *
 * The whole board's height at `BOLT_SPEED` (`900` units per second,
 * specs/cursor.md), far past the half tile the bolt has to climb and still
 * bounded — and far short of `ARC_LIFE` (`0.32` s), so the arcs are still live
 * when the sweep stops.
 */
const BOLT_SWEEP_TICKS = ticksFor(BOARD_H / BOLT_SPEED);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws lightning along the segment joining each pair of linked tiles", async () => {
  startPlaying(h);
  // Two charged nodes inside the struck node's own 5 x 5 block: one along its
  // row, one on the diagonal, so the chain reports one arc of each shape.
  h.debug.setNode(STRUCK_C, STRUCK_R, CHARGE_MAX);
  h.debug.setNode(STRUCK_C + DISCHARGE_RADIUS, STRUCK_R, CONDUCTING_CHARGE);
  h.debug.setNode(
    STRUCK_C + DISCHARGE_RADIUS,
    STRUCK_R + DISCHARGE_RADIUS,
    CONDUCTING_CHARGE,
  );
  poseBolt(h, STRUCK_C, STRUCK_R + 1);

  const swept = await h.until((s) => s.arcs.length > 0, {
    maxFrames: BOLT_SWEEP_TICKS,
  });
  captureStill(h, "arcs");

  assertTrue(
    swept.hit,
    `the discharge to report its arcs within ${BOLT_SWEEP_TICKS} frames of ` +
      "the bolt being posed a tile below the critical node " +
      "(specs/discharge.md)",
  );

  const board = meanColor(h, tileBox(BARE_C, BARE_R));
  for (const arc of swept.snapshot.arcs) {
    const from = { x: tileCX(arc.from.c), y: tileCY(arc.from.r) };
    const to = { x: tileCX(arc.to.c), y: tileCY(arc.to.r) };
    const span = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    // The unit normal to the link, which is the direction the corridor widens in.
    const nx = -(to.y - from.y) / span;
    const ny = (to.x - from.x) / span;

    for (let i = 0; i < SAMPLES_ALONG; i += 1) {
      const t = i / (SAMPLES_ALONG - 1);
      const cx = from.x + (to.x - from.x) * t;
      const cy = from.y + (to.y - from.y) * t;

      let boldest = 0;
      for (let off = -CORRIDOR_HALF; off <= CORRIDOR_HALF; off += 1) {
        const apart = colorDistance(
          pixelColor(h, cx + nx * off, cy + ny * off),
          board,
        );
        if (apart > boldest) boldest = apart;
      }
      if (boldest <= APART_MIN) {
        fail(
          `drawing more than ${APART_MIN} of 441 from the board within ` +
            `${CORRIDOR_HALF} units of (${Math.round(cx)}, ${Math.round(cy)}), ` +
            `on the segment joining tile (${arc.from.c}, ${arc.from.r}) to ` +
            `tile (${arc.to.c}, ${arc.to.r}) — specs/discharge.md: an arc is ` +
            "drawn as bright lightning joining the centers of the two tiles " +
            "it links",
          boldest,
        );
      }
    }
  }
});
