// presentation/sprite-pan — the one-tile floe is drawn from the frame this case
// seeds, at the width its single tile spans.
//
// specs/assets.md seeds `assets/pan/` as one `32 x 32` frame covering one tile,
// and fixes how it is drawn: a lane item's frame is drawn "`32` units wide for
// every tile the item spans, with its left edge on the item's own `x` and its
// top on its row's top edge ... a one-tile floe `PAN_W` (`32`) over its one".
// specs/water.md gives the `pan` kind that art.
//
// THE READING IS THE IMAGE SOURCE, NOT THE PIXELS ON THE STAGE: the bitmap the
// draw was handed is held against the seeded PNG, so a build that painted a
// convincing ice pan in code fails here whatever it looks like. That matters
// most for the floes, because a floe is what the critter stands on over the
// water: art that is drawn but not from the seeded frame is a floe the player
// has to learn to read.
//
// ONE PAN ON AN OTHERWISE EMPTY STRAIT, on a pan lane (specs/water.md gives rows
// `5` and `8` to pans), held still by `poseLane`. specs/assets.md never mirrors
// a floe, so the lane's direction is nothing this point reads.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import { PAN_W, TILE } from "../constants";
import {
  captureStill,
  createHarness,
  drawnFrom,
  type Harness,
  startCrossing,
} from "../harness";
import { laneArt } from "./lane-art";

/** A pan lane (specs/water.md). */
const ROW = 5;

/** Where its left edge is put: one whole tile, well inside the strait. */
const COL = 10;

/**
 * How far a draw's centre may sit from the centre of the tile it spans.
 *
 * specs/assets.md puts the frame's left edge on the item's own `x` and its top
 * on its row's top edge, so a conforming draw's centre is exactly that tile's
 * centre. Half a tile is the widest this can be and still name the tile rather
 * than a neighbouring one; the lane is stopped, so a conforming build measures
 * zero.
 */
const CENTRED_WITHIN = TILE / 2;

/**
 * How far the drawn width may sit from `PAN_W`, in stage units.
 *
 * The figure is exact — `32` units over one tile — so this is room for rounding
 * on a canvas drawn at one unit per pixel rather than a likeness tolerance.
 */
const WIDTH_TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a one-tile floe from assets/pan/ over the tile it spans", async () => {
  await startCrossing(h);
  const { blits, item, centre } = await laneArt(h, ROW, "pan", COL);
  await captureStill(h, "scene");

  const drawn = drawnFrom(blits, "pan", centre, CENTRED_WITHIN);
  assertGreaterThanOrEqual(
    drawn.length,
    1,
    `the pan spanning [${item.x}, ${item.x + TILE * item.len}) on row ` +
      `${item.row} drawn from assets/pan/0.png (specs/assets.md), matched ` +
      `pixel for pixel against the seeded PNG`,
  );
  assertLessThanOrEqual(
    Math.abs(drawn[0].width - PAN_W),
    WIDTH_TOLERANCE,
    `how far the pan's drawn width (${drawn[0].width}) sits from PAN_W ` +
      `(${PAN_W}), the span of its one tile (specs/assets.md)`,
  );
});
