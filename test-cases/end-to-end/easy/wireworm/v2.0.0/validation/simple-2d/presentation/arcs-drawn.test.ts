// presentation/arcs-drawn — a discharge draws lightning between the tiles it
// links.
//
// specs/discharge.md, on drawing an arc: "An arc is drawn as bright lightning
// joining the centers of the two tiles it links, so a player reads which node set
// off which." That sentence names one thing a script can decide — that something
// runs BETWEEN the two centres — and, in its next breath, several it cannot: "The
// color and the form of the lightning are yours." So the polyline itself is
// reviewed and not asserted, and what is asserted here is that the stretch of
// board joining each linked pair carries drawing.
//
// EVERY LINK THE SNAPSHOT REPORTS IS READ, and the two the scenario produces are
// deliberately different shapes — one along a row, one on the diagonal — so a
// build that drew only the axis-aligned case is named. Which links a discharge
// conducts along is discharge/arcs-reported's requirement, not this point's: the
// links are read from the snapshot and taken as given, so a build that got the
// chain wrong is docked once, there.
//
// WHAT "BETWEEN" IS. The box spans the chord and is held one half-tile in from
// each end, so the two tiles the arc joins are outside it and only what runs
// between them is read; on either axis it is never narrower than a tile, which is
// the room "the form of the lightning is yours" needs — lightning is drawn
// jagged, and a form that wandered off the chord entirely would no longer read as
// joining two particular tile centres.
//
// THE CONTROL IS THE SAME BOARD ONCE THE ARC HAS GONE. specs/overview.md fixes no
// palette and leaves the board's look to the build, so a box held against some
// other tile's colour would read a build's own trace as lightning. Held against
// itself, the only thing that can move is what the arc drew — and both detonated
// nodes are removed by the chain ("A detonated node is removed from the board,
// and its tile is left empty"), so they are absent from both readings.
//
// NO FIGURE IS ASSERTED. `getImageData` returns the bytes that are there, so a
// box the arc drew nothing into comes back byte-identical to itself and measures
// exactly `0`. How brightly the lightning reads is appearance, and the reviewer's
// from the captured still.

import { afterEach, beforeEach, it } from "vitest";
import {
  ARC_LIFE,
  BOARD_H,
  BOLT_SPEED,
  CHARGE_MAX,
  DISCHARGE_RADIUS,
  TILE,
  tileCX,
  tileCY,
} from "../constants";
import { assertGreaterThan, assertLength, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  poseBolt,
  startPlaying,
  ticksFor,
  type ArcSnapshot,
  type Harness,
} from "../harness";

/** The tile the critical node stands on, and the row it is on. */
const STRUCK_C = 12;
const STRUCK_R = 6;

/** The lowest charge specs/discharge.md conducts through: "charge 1 or above". */
const CONDUCTING_CHARGE = 1;

/**
 * The most frames the bolt is given to resolve.
 *
 * The whole board's height at `BOLT_SPEED` (`900` units per second,
 * specs/cursor.md), far past the half tile the bolt has to climb and still
 * bounded — and far short of `ARC_LIFE` (`0.32` s), so the arcs are still live
 * when the sweep stops.
 */
const BOLT_SWEEP_TICKS = ticksFor(BOARD_H / BOLT_SPEED);

/** The stretch of stage one arc's lightning is read over, in logical units. */
interface Between {
  arc: ArcSnapshot;
  x: number;
  y: number;
  halfX: number;
  halfY: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * The board between the two tiles an arc links: the chord's own box, held half a
 * tile in from each end so neither linked tile is inside it, and never narrower
 * than a tile on either axis.
 */
function between(arc: ArcSnapshot): Between {
  const from = { x: tileCX(arc.from.c), y: tileCY(arc.from.r) };
  const to = { x: tileCX(arc.to.c), y: tileCY(arc.to.r) };
  return {
    arc,
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2,
    halfX: Math.max(TILE / 2, Math.abs(to.x - from.x) / 2 - TILE / 2),
    halfY: Math.max(TILE / 2, Math.abs(to.y - from.y) / 2 - TILE / 2),
  };
}

/** Every device pixel of one stretch of board. */
function readBetween(span: Between): Uint8ClampedArray {
  const from = h.device(span.x - span.halfX, span.y - span.halfY);
  const to = h.device(span.x + span.halfX, span.y + span.halfY);
  return h.ctx.getImageData(
    from.x,
    from.y,
    Math.max(1, to.x - from.x),
    Math.max(1, to.y - from.y),
  ).data;
}

/** How far the furthest pixel of one reading moved against the other. */
function furthestMove(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
): number {
  let furthest = 0;
  const length = Math.min(before.length, after.length);
  for (let at = 0; at + 2 < length; at += 4) {
    const moved = Math.hypot(
      after[at] - before[at],
      after[at + 1] - before[at + 1],
      after[at + 2] - before[at + 2],
    );
    if (moved > furthest) furthest = moved;
  }
  return furthest;
}

it("draws lightning between each pair of linked tiles", async () => {
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

  const spans = swept.snapshot.arcs.map(between);
  const drawn = spans.map(readBetween);

  // The same stretches of the same board once every arc's life has run out: the
  // control each reading above is held against.
  await h.advance(ticksFor(ARC_LIFE) + 1);
  assertLength(
    h.snapshot().arcs,
    0,
    `every arc gone once ARC_LIFE (${ARC_LIFE} s) has run out ` +
      "(specs/discharge.md)",
  );
  const bare = spans.map(readBetween);

  spans.forEach((span, index) => {
    const { arc } = span;
    assertGreaterThan(
      furthestMove(bare[index], drawn[index]),
      0,
      `the arc joining (${arc.from.c}, ${arc.from.r}) to (${arc.to.c}, ` +
        `${arc.to.r}) to carry drawn pixels that differ from what that same ` +
        `board carries once the arc has gone, over the stretch between those ` +
        `two tile centres — ${(2 * span.halfX).toFixed(0)} by ` +
        `${(2 * span.halfY).toFixed(0)} units about (${span.x.toFixed(0)}, ` +
        `${span.y.toFixed(0)}) (specs/discharge.md: an arc is drawn as bright ` +
        "lightning joining the centers of the two tiles it links)",
    );
  });
});
