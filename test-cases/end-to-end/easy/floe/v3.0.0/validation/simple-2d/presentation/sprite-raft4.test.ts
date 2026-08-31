// presentation/sprite-raft4 — the four-tile raft is drawn from the WHOLE of
// `assets/raft/1.png`, over the four tiles it spans.
//
// specs/assets.md: "The four-tile raft is the whole of `assets/raft/1.png`, drawn
// over its four tiles ... frame `1` is the four-tile raft, filling the whole
// `128 x 32`", and `RAFT_W` (`128`) is the width of the raft art itself.
// specs/water.md gives the `raft4` kind that frame. Its sibling point,
// `presentation/sprite-raft3`, decides the other cut of the same folder; a build
// can get either one wrong on its own, which is why they are two points.
//
// THE READING IS THE IMAGE SOURCE, NOT THE PIXELS ON THE STAGE: the bitmap the
// draw was handed — or the sub-rect of it the call named — is held against the
// seeded region. A build that drew frame `0` here, or the left `96 x 32` of
// either frame stretched over four tiles, is reported as having drawn what it
// actually drew and fails.
//
// THE WIDTH IS READ AS WELL AS THE FRAME, because a floe is footing: a raft drawn
// narrower than the tiles it covers shows the critter standing on water it is
// actually riding, and specs/assets.md asks that "a long floe reads as one
// continuous slab".
//
// ONE RAFT ON AN OTHERWISE EMPTY STRAIT, on a `raft4` lane (specs/water.md gives
// rows `3`, `6` and `9` to four-tile rafts), held still by `poseLane`.
// specs/assets.md never mirrors a floe, so the lane's direction is nothing this
// point reads.

import { afterEach, beforeEach, it } from "vitest";
import { RAFT_W, TILE } from "../../src/constants";
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
 * How far the drawn width may sit from `RAFT_W`, in stage units.
 *
 * The figure is exact — `128` units over four tiles — so this is room for rounding
 * on a canvas drawn at one unit per pixel rather than a likeness tolerance.
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
  captureStill(h, "scene");

  const drawn = drawnRegion(sprites, "raft", "raft4", centre, CENTRED_WITHIN);
  assertGreaterThanOrEqual(
    drawn.length,
    1,
    `the four-tile raft spanning [${item.x}, ${item.x + TILE * item.len}) on ` +
      `row ${item.row} drawn from the whole of assets/raft/1.png ` +
      `(specs/assets.md) — the frame drew ` +
      `${describeDrawsFrom(sprites, "raft")}`,
  );
  assertLessThanOrEqual(
    Math.abs(drawn[0].image.w - RAFT_W),
    WIDTH_TOLERANCE,
    `how far the raft's drawn width (${drawn[0].image.w}) sits from RAFT_W ` +
      `(${RAFT_W}), the span of its four tiles (specs/assets.md)`,
  );
});
