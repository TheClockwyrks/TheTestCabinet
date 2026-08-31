// Floe — presentation/sprite-pan: the one-tile floe is drawn from the frame
// this case seeds, at the width its single tile spans.
//
// specs/assets.md seeds `assets/pan/` as one `32 x 32` frame covering one tile,
// and fixes how it is drawn: "A lane item's frame is drawn `32` units wide for
// every tile the item spans, with its left edge on the item's own `x` and its top
// on its row's top edge" — `PAN_W` (`32`) over its one. Both halves are read
// here, because a build that blits the right bitmap at some other width has drawn
// a floe that does not cover the tile the critter rides on.
//
// THE READING IS THE IMAGE SOURCE, NOT THE PIXELS ON THE STAGE: the bitmap the
// draw was handed is held against the seeded PNG, so a build that painted a
// convincing pan in code fails here whatever it looks like. Tinting and scaling
// are the build's, and a stage sample would grade the tint rather than the art.
//
// ONE PAN ON AN OTHERWISE EMPTY STRAIT, on a lane specs/water.md gives that kind,
// held still by `poseLane` so the draw's destination box can be held against the
// span the specification fixes. specs/assets.md never mirrors a floe, so the
// lane's direction is nothing this point reads.

import { afterEach, beforeEach, it } from "vitest";
import { PAN_W, TILE } from "../../src/constants";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startCrossing,
  type Harness,
} from "../harness";
import { describeDrawsFrom, drawnFrom } from "./sprites";
import { laneArt } from "./lane-art";

/** A pan lane (specs/water.md). */
const ROW = 5;

/** Where its left edge is put: one whole tiles, well inside the strait. */
const COL = 10;

/**
 * How far a draw's centre may sit from the centre of the box its tiles span, in
 * stage units.
 *
 * specs/assets.md puts the frame's left edge on the item's own `x` and its top on
 * its row's top edge, so a conforming draw's centre is exactly the centre of that
 * box. Half a tile is the widest this can be and still name the span rather than
 * a neighbouring one; the lane is stopped, so a conforming build measures zero.
 */
const CENTRED_WITHIN = TILE / 2;

/**
 * How far the drawn width may sit from `PAN_W`, in stage units.
 *
 * The figure is exact — `32` units over one tile — so this is not a
 * likeness tolerance but room for rounding on a canvas drawn at one unit per
 * pixel. A build that stretched the frame over two tiles misses by 32.
 */
const WIDTH_TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a one-tile floe from assets/pan/ over the tile it spans", async () => {
  startCrossing(h);
  const { sprites, item, centre } = await laneArt(h, ROW, "pan", COL);
  // Before the assertions, so a failing check still leaves the picture of the
  // frame whose draws were read.
  captureStill(h, "scene");

  const drawn = drawnFrom(sprites, "pan", centre, CENTRED_WITHIN);
  assertGreaterThanOrEqual(
    drawn.length,
    1,
    `the pan spanning [${item.x}, ${item.x + TILE * item.len}) on row ` +
      `${item.row} drawn from assets/pan/0.png (specs/assets.md), matched ` +
      `pixel for pixel against the seeded PNG — the frame drew ` +
      `${describeDrawsFrom(sprites, "pan")}`,
  );
  assertLessThanOrEqual(
    Math.abs(drawn[0].w - PAN_W),
    WIDTH_TOLERANCE,
    `how far the pan's drawn width (${drawn[0].w}) sits from PAN_W ` +
      `(32), the span of its one tile (specs/assets.md)`,
  );
});
