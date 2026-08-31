// Floe — presentation/sprite-raft3: the three-tile raft is drawn from the LEFT
// `96 x 32` of `assets/raft/0.png`, not from the whole of it.
//
// specs/assets.md seeds `assets/raft/` as two `128 x 32` frames and states the
// cut explicitly: "The three-tile raft is the left `96 x 32` of
// `assets/raft/0.png`, drawn over its three tiles ... frame `0` is the three-tile
// raft, drawn in the left `96 x 32` of the image with its right tile
// transparent". specs/water.md gives the `raft3` kind that frame. The sub-rect is
// stated in the specification precisely because it is not derivable from the
// folder table, so a build has been told it and this point may read it.
//
// WHY THE SUB-RECT AND NOT JUST THE FILE. A build that squeezed the whole
// `128 x 32` frame into the raft's `96` units draws a raft whose art is
// horizontally compressed and whose right tile carries a quarter of the sheet's
// transparent margin — it reads as three small floes butted together rather than
// as the one continuous slab specs/assets.md asks for. The comparison therefore
// holds the CROPPED source the draw named against the seeded region, so that
// build is reported as having drawn `raft` frame `0` region `full` and fails. A
// build that cropped those same pixels into a bitmap of its own before drawing is
// read the same way: what the specification fixes is which pixels land on the
// three tiles, not which call form put them there.
//
// THE READING IS THE IMAGE SOURCE, NOT THE PIXELS ON THE STAGE: what is compared
// is the bitmap, or the sub-rect of it, that the draw was handed.
//
// ONE RAFT ON AN OTHERWISE EMPTY STRAIT, on a `raft3` lane (specs/water.md gives
// rows `2`, `4` and `7` to three-tile rafts), held still by `poseLane`.
// specs/assets.md never mirrors a floe, so the lane's direction is nothing this
// point reads.

import { afterEach, beforeEach, it } from "vitest";
import { SPRITE_TILE, TILE } from "../../src/constants";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startCrossing,
  type Harness,
} from "../harness";
import { describeDrawsFrom, drawnRegion } from "./sprites";
import { laneArt } from "./lane-art";

/** A three-tile raft lane (specs/water.md). */
const ROW = 7;

/** Where its left edge is put: three whole tiles, well inside the strait. */
const COL = 10;

/**
 * The span of a three-tile raft, in stage units.
 *
 * `TILE * 3`, which specs/assets.md also names as the width of the sub-rect the
 * art is cut from — `3 * SPRITE_TILE`, the two figures being equal because a
 * 32 x 32 frame maps onto one tile at a scale of one.
 */
const RAFT3_W = TILE * 3;

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
 * How far the drawn width may sit from the raft's three-tile span.
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

it("draws a three-tile raft from the left 96 x 32 of assets/raft/0.png", async () => {
  startCrossing(h);
  const { sprites, item, centre } = await laneArt(h, ROW, "raft3", COL);
  // Before the assertions, so a failing check still leaves the picture of the
  // frame whose draws were read.
  captureStill(h, "scene");

  const drawn = drawnRegion(sprites, "raft", "raft3", centre, CENTRED_WITHIN);
  assertGreaterThanOrEqual(
    drawn.length,
    1,
    `the three-tile raft spanning [${item.x}, ${item.x + TILE * item.len}) on ` +
      `row ${item.row} drawn from the left ${3 * SPRITE_TILE} x ` +
      `${SPRITE_TILE} of assets/raft/0.png (specs/assets.md) — the frame drew ` +
      `${describeDrawsFrom(sprites, "raft")}`,
  );
  assertLessThanOrEqual(
    Math.abs(drawn[0].w - RAFT3_W),
    WIDTH_TOLERANCE,
    `how far the raft's drawn width (${drawn[0].w}) sits from ${RAFT3_W}, the ` +
      `span of its three tiles (specs/assets.md)`,
  );
});
