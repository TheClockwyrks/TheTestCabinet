// presentation/sprite-plow — a plow is drawn from the frame this case seeds, at
// the width its three tiles span.
//
// specs/assets.md seeds `assets/plow/` as one `96 x 32` frame covering three
// tiles, and fixes how it is drawn: "A lane item's frame is drawn `32` units
// wide for every tile the item spans, with its left edge on the item's own `x`
// and its top on its row's top edge: a plow `PLOW_W` (`96`) units wide over its
// three tiles". Both halves are read here, because a build that blits the right
// bitmap one tile wide has drawn a plow that does not cover the tiles it kills
// the critter on.
//
// THE READING IS THE IMAGE SOURCE, NOT THE PIXELS ON THE STAGE: the bitmap the
// draw was handed is held against the seeded PNG, so a build that painted a
// convincing plow in code fails here whatever it looks like. Tinting and scaling
// are the build's, and a stage sample would grade the tint rather than the art.
//
// ONE PLOW ON AN OTHERWISE EMPTY STRAIT, on a plow lane (specs/ice.md gives rows
// `11`, `14` and `17` to plows), held still by `poseLane` so the draw's
// destination box can be held against the span the specification fixes. Row `14`
// runs rightward, which is the unmirrored orientation: whether a leftward lane's
// vehicle is drawn mirrored is `presentation/mirror-leftward-vehicle`'s point,
// not this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import { PLOW_W, TILE } from "../constants";
import {
  captureStill,
  createHarness,
  drawnFrom,
  type Harness,
  startCrossing,
} from "../harness";
import { laneArt } from "./lane-art";

/** A plow lane that runs rightward, so nothing here reads a mirrored draw. */
const ROW = 14;

/** Where its left edge is put: three whole tiles, well inside the strait. */
const COL = 10;

/**
 * How far a draw's centre may sit from the centre of the box its tiles span, in
 * stage units.
 *
 * specs/assets.md puts the frame's left edge on the item's own `x` and its top
 * on its row's top edge, so a conforming draw's centre is exactly the centre of
 * that box. Half a tile is the widest this can be and still name the span rather
 * than a neighbouring one; the lane is stopped, so a conforming build measures
 * zero.
 */
const CENTRED_WITHIN = TILE / 2;

/**
 * How far the drawn width may sit from `PLOW_W`, in stage units.
 *
 * The figure is exact — `96` units over three tiles — so this is not a likeness
 * tolerance but room for rounding on a canvas drawn at one unit per pixel. A
 * build that drew the frame one tile wide misses by `64`.
 */
const WIDTH_TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a plow from assets/plow/ across the three tiles it spans", async () => {
  await startCrossing(h);
  const { blits, item, centre } = await laneArt(h, ROW, "plow", COL);
  // Before the assertions, so a failing check still leaves the picture of the
  // frame whose draws were read.
  await captureStill(h, "scene");

  const drawn = drawnFrom(blits, "plow", centre, CENTRED_WITHIN);
  assertGreaterThanOrEqual(
    drawn.length,
    1,
    `the plow spanning [${item.x}, ${item.x + TILE * item.len}) on row ` +
      `${item.row} drawn from assets/plow/0.png (specs/assets.md), matched ` +
      `pixel for pixel against the seeded PNG`,
  );
  assertLessThanOrEqual(
    Math.abs(drawn[0].width - PLOW_W),
    WIDTH_TOLERANCE,
    `how far the plow's drawn width (${drawn[0].width}) sits from PLOW_W ` +
      `(${PLOW_W}), the span of its three tiles (specs/assets.md)`,
  );
});
