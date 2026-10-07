// presentation/sprite-dogsled — a dogsled is drawn from the frame this case
// seeds, at the width its two tiles span.
//
// specs/assets.md seeds `assets/dogsled/` as one `64 x 32` frame covering two
// tiles, and fixes how it is drawn: a lane item's frame is drawn "`32` units
// wide for every tile the item spans, with its left edge on the item's own `x`
// and its top on its row's top edge ... a dogsled `DOGSLED_W` (`64`)". Both
// halves are read here: a build that blits the right bitmap one tile wide has
// drawn a dogsled that does not cover the second tile it kills the critter on.
//
// THE READING IS THE IMAGE SOURCE, NOT THE PIXELS ON THE STAGE: the bitmap the
// draw was handed is held against the seeded PNG, so a build that painted a
// convincing sled in code fails here whatever it looks like.
//
// ONE DOGSLED ON AN OTHERWISE EMPTY STRAIT, on a dogsled lane (specs/ice.md
// gives rows `13` and `16` to dogsleds), held still by `poseLane`. Row `16` runs
// rightward, the unmirrored orientation, because whether a leftward lane's
// vehicle is drawn mirrored is `presentation/mirror-leftward-vehicle`'s point.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import { DOGSLED_W, TILE } from "../constants";
import {
  captureStill,
  createHarness,
  drawnFrom,
  type Harness,
  startCrossing,
} from "../harness";
import { laneArt } from "./lane-art";

/** A dogsled lane that runs rightward, so nothing here reads a mirrored draw. */
const ROW = 16;

/** Where its left edge is put: two whole tiles, well inside the strait. */
const COL = 10;

/**
 * How far a draw's centre may sit from the centre of the box its tiles span.
 *
 * specs/assets.md puts the frame's left edge on the item's own `x` and its top
 * on its row's top edge, so a conforming draw's centre is exactly that box's
 * centre. Half a tile is the widest this can be and still name the span rather
 * than a neighbouring one; the lane is stopped, so a conforming build measures
 * zero.
 */
const CENTRED_WITHIN = TILE / 2;

/**
 * How far the drawn width may sit from `DOGSLED_W`, in stage units.
 *
 * The figure is exact — `64` units over two tiles — so this is room for rounding
 * on a canvas drawn at one unit per pixel rather than a likeness tolerance. A
 * build that drew the frame one tile wide misses by `32`.
 */
const WIDTH_TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a dogsled from assets/dogsled/ across the two tiles it spans", async () => {
  await startCrossing(h);
  const { blits, item, centre } = await laneArt(h, ROW, "dogsled", COL);
  await captureStill(h, "scene");

  const drawn = drawnFrom(blits, "dogsled", centre, CENTRED_WITHIN);
  assertGreaterThanOrEqual(
    drawn.length,
    1,
    `the dogsled spanning [${item.x}, ${item.x + TILE * item.len}) on row ` +
      `${item.row} drawn from assets/dogsled/0.png (specs/assets.md), matched ` +
      `pixel for pixel against the seeded PNG`,
  );
  assertLessThanOrEqual(
    Math.abs(drawn[0].width - DOGSLED_W),
    WIDTH_TOLERANCE,
    `how far the dogsled's drawn width (${drawn[0].width}) sits from ` +
      `DOGSLED_W (${DOGSLED_W}), the span of its two tiles (specs/assets.md)`,
  );
});
