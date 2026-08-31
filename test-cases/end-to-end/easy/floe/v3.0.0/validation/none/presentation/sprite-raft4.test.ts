// presentation/sprite-raft4 — the four-tile raft is drawn from the WHOLE of
// `assets/raft/1.png`, over the four tiles it spans.
//
// specs/assets.md seeds `assets/raft/` as two `128 x 32` frames and states which
// is which: "The four-tile raft is the whole of `assets/raft/1.png`, drawn over
// its four tiles ... frame `1` is the four-tile raft, filling the whole
// `128 x 32`". specs/water.md gives the `raft4` kind that frame. Its sibling
// `presentation/sprite-raft3` decides the cut frame; this point decides the
// uncut one, and the two fail independently: a build that drew frame `0` for
// both long floes passes neither, and a build that mixed the two up passes
// neither either.
//
// THE READING IS THE IMAGE SOURCE, NOT THE PIXELS ON THE STAGE: the bitmap, or
// the sub-rect of it, that the draw was handed is held against the seeded PNG,
// so a build that painted a convincing slab in code fails here whatever it looks
// like. A long floe has to read as "one continuous slab rather than as small
// floes butted together" (specs/assets.md), which is what drawing the whole
// frame across the whole span produces.
//
// ONE RAFT ON AN OTHERWISE EMPTY STRAIT, on a `raft4` lane (specs/water.md gives
// rows `3`, `6` and `9` to four-tile rafts), held still by `poseLane`.
// specs/assets.md never mirrors a floe, so the lane's direction is nothing this
// point reads.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import { RAFT_W, TILE } from "../constants";
import {
  blitsOf,
  captureStill,
  createHarness,
  drawnRegion,
  type Harness,
  startCrossing,
} from "../harness";
import { laneArt } from "./lane-art";

/** A four-tile raft lane (specs/water.md). */
const ROW = 3;

/** Where its left edge is put: four whole tiles, well inside the strait. */
const COL = 10;

/**
 * The span of a four-tile raft, in stage units: `TILE * 4`, which is also
 * `RAFT_W` (`128`), the width of the raft art itself (specs/assets.md).
 */
const RAFT4_W = TILE * 4;

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
 * How far the drawn width may sit from the raft's four-tile span.
 *
 * The figure is exact, so this is room for rounding on a canvas drawn at one
 * unit per pixel rather than a likeness tolerance.
 */
const WIDTH_TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a four-tile raft from the whole of assets/raft/1.png", async () => {
  await startCrossing(h);
  const { blits, item, centre } = await laneArt(h, ROW, "raft4", COL);
  await captureStill(h, "scene");

  // What was actually drawn from the raft folder anywhere in the frame, so a
  // build that reached for the other frame is named rather than merely missed.
  const fromRaft = blitsOf(blits, "raft").flatMap((blit) =>
    blit.matches
      .filter((frame) => frame.sheet === "raft")
      .map((frame) => `frame ${frame.index} region ${frame.region}`),
  );

  const drawn = drawnRegion(blits, "raft", "raft4", centre, CENTRED_WITHIN);
  assertGreaterThanOrEqual(
    drawn.length,
    1,
    `the four-tile raft spanning [${item.x}, ${item.x + TILE * item.len}) on ` +
      `row ${item.row} drawn from the whole ${RAFT_W} x ${TILE} of ` +
      `assets/raft/1.png (specs/assets.md) — the frame drew ` +
      `${fromRaft.length === 0 ? "no seeded raft art at all" : fromRaft.join(", ")}`,
  );
  assertLessThanOrEqual(
    Math.abs(drawn[0].width - RAFT4_W),
    WIDTH_TOLERANCE,
    `how far the raft's drawn width (${drawn[0].width}) sits from ` +
      `${RAFT4_W}, the span of its four tiles (specs/assets.md)`,
  );
});
