// Floe — presentation/sprite-raft4: the four-tile raft is drawn from the WHOLE of
// `assets/raft/1.png`, over the four tiles it spans.
//
// specs/assets.md seeds `assets/raft/` as two `128 x 32` frames and names the
// second outright: "The four-tile raft is the whole of `assets/raft/1.png`, drawn
// over its four tiles ... frame `1` ... fills the whole `128 x 32`".
// specs/water.md gives the `raft4` kind that frame. `RAFT_W` (`128`) is the width
// of the raft art itself, and four tiles of `TILE` (`32`) is the span it is drawn
// over — the two coincide, which is what makes a four-tile raft the one long floe
// drawn at its art's own size.
//
// WHY THE WHOLE FRAME AND NOT MERELY THE FILE. Its sibling point,
// `presentation/sprite-raft3`, reads the LEFT `96 x 32` of frame `0`; this one
// reads frame `1` entire. A build that reached for the three-tile crop here would
// draw three quarters of a raft over four tiles, leaving its right tile bare
// while the covering rule still kills the critter that steps off it — so the two
// points read two different regions and a build that confused them fails the one
// it confused.
//
// THE READING IS THE IMAGE SOURCE, NOT THE PIXELS ON THE STAGE: what is compared
// is the bitmap, or the sub-rect of it, that the draw was handed. A build free to
// tint or scale what it blits is graded on the art rather than on the tint.
//
// ONE RAFT ON AN OTHERWISE EMPTY STRAIT, on a `raft4` lane (specs/water.md gives
// rows `3`, `6` and `9` to four-tile rafts), held still by `poseLane`.
// specs/assets.md never mirrors a floe, so the lane's direction is nothing this
// point reads.

import { afterEach, beforeEach, it } from "vitest";
import { RAFT_W, TILE } from "../constants";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startCrossing,
  type Harness,
} from "../harness";
import { describeDrawsFrom, drawnRegion } from "./sprites";
import { laneArt } from "./lane-art";

/** A four-tile raft lane (specs/water.md). */
const ROW = 3;

/** Where its left edge is put: four whole tiles, well inside the strait. */
const COL = 10;

/** The span of a four-tile raft, in stage units: `TILE * 4`, which is `RAFT_W`. */
const RAFT4_W = TILE * 4;

/**
 * How far a draw's centre may sit from the centre of the box its tiles span.
 *
 * specs/assets.md puts the frame's left edge on the item's own `x` and its top on
 * its row's top edge, so a conforming draw's centre is exactly that box's centre.
 * Half a tile is the widest this can be and still name the span rather than a
 * neighbouring one; the lane is stopped, so a conforming build measures zero.
 */
const CENTRED_WITHIN = TILE / 2;

/**
 * How far the drawn width may sit from the raft's four-tile span.
 *
 * The figure is exact, so this is room for rounding on a canvas drawn at one unit
 * per pixel rather than a likeness tolerance.
 */
const WIDTH_TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a four-tile raft from the whole of assets/raft/1.png", async () => {
  startCrossing(h);
  const { sprites, item, centre } = await laneArt(h, ROW, "raft4", COL);
  // Before the assertions, so a failing check still leaves the picture of the
  // frame whose draws were read.
  captureStill(h, "scene");

  const drawn = drawnRegion(sprites, "raft", "raft4", centre, CENTRED_WITHIN);
  assertGreaterThanOrEqual(
    drawn.length,
    1,
    `the four-tile raft spanning [${item.x}, ${item.x + TILE * item.len}) on ` +
      `row ${item.row} drawn from the whole ${RAFT_W} x ${TILE} of ` +
      `assets/raft/1.png (specs/assets.md) — the frame drew ` +
      `${describeDrawsFrom(sprites, "raft")}`,
  );
  assertLessThanOrEqual(
    Math.abs(drawn[0].w - RAFT4_W),
    WIDTH_TOLERANCE,
    `how far the raft's drawn width (${drawn[0].w}) sits from ${RAFT4_W}, the ` +
      `span of its four tiles (specs/assets.md)`,
  );
});
