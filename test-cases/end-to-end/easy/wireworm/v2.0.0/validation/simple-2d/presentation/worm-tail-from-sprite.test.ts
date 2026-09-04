// presentation/worm-tail-from-sprite — the trailing segment is drawn from a tail frame.
//
// specs/assets.md seeds `assets/worm/` as "a two-frame pair for each of the three
// parts of a chain" and tabulates which pair belongs to which part: frames `0`
// and `1` are the head, `2` and `3` the body, `4` and `5` the tail. This point
// owns the tail pair alone — presentation/worm-head-from-sprite,
// presentation/worm-body-from-sprite and presentation/worm-tail-from-sprite are
// three points rather than one, so a build that drew one part from the wrong pair
// is named for the part it got wrong. Together they are what holds a build to the
// third clause of specs/overview.md's legibility row for the worm, that "its
// head, its body, and its tail are told apart".
//
// SO THE READING IS THE IMAGE SOURCE ITSELF, NOT THE PIXELS ON THE STAGE. The
// bitmap the build handed the context is held against the seeded PNGs read off
// the workspace's own `assets/` tree, so a source that IS a seeded frame matches
// it and a shape drawn in code does not.
//
// THE DRAW IS NAMED BY THE SEGMENT IT WAS DRAWN FOR, by the tile its destination
// box is centred on. The worm is posed FOUR segments long, so its trailing segment is
// unambiguous: segments[3] is the last of the four, which is the tail.
//
// THE WORM IS POSED WITH ITS STEP HELD. Which frame a part is drawn from is not a
// faculty, so `setWormStepping(id, false)` leaves the worm on the tiles it was
// posed on and every draw is attributed to a known tile. It heads right, which is
// the heading `addWorm` opens with and the one the art itself faces
// (specs/assets.md), so nothing here turns on the mirroring that
// presentation/worm-mirrored decides.

import { afterEach, beforeEach, it } from "vitest";
import { TILE, tileCX, tileCY } from "../../src/constants";
import { assertLength, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  drawnImages,
  lastWorm,
  poseWorm,
  startPlaying,
  type Harness,
} from "../harness";
import { framesDrawnAt, frameName, spriteReader } from "./reading";

/**
 * How far a draw's destination centre may sit from the segment it is attributed
 * to, in logical units.
 *
 * specs/board.md draws a worm segment "centered on that point" like a node, so
 * half a tile (`TILE / 2`, `16`) is the whole of the slack, and it is half the
 * distance to the next segment along, so no draw can be attributed to the wrong
 * segment.
 */
const ATTRIBUTION_MAX = TILE / 2;

/** The row the worm is posed on: mid-board, far from the band and the entry row. */
const WORM_ROW = 10;

/** The worm: head on this tile, four segments, heading right. */
const HEAD_C = 20;
const WORM_LENGTH = 4;

/** The pair of frames specs/assets.md gives the tail. */
const TAIL_FRAMES = [4, 5];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the trailing segment from frame 4 or 5 of assets/worm/", async () => {
  startPlaying(h);
  const id = poseWorm(h, HEAD_C, WORM_ROW, WORM_LENGTH);
  h.debug.setWormStepping(id, false);

  const drawn = drawnImages(h, await drawFrame(h));
  captureStill(h, "tail");

  const worm = lastWorm(h.snapshot());
  assertLength(
    worm.segments,
    WORM_LENGTH,
    "the segments the posed worm still holds: a head from addWorm and three " +
      "appended behind it, none of which anything has removed " +
      "(specs/instrumentation.md)",
  );
  const tile = worm.segments[3];

  const matches = await framesDrawnAt(
    spriteReader(),
    drawn,
    tileCX(tile.c),
    tileCY(tile.r),
    ATTRIBUTION_MAX,
  );
  assertTrue(
    matches.some(
      (match) => match.folder === "worm" && TAIL_FRAMES.includes(match.index),
    ),
    `the trailing segment of a four-segment worm, on tile (${tile.c}, ${tile.r}), drawn ` +
      "from frame 4 or 5 of assets/worm/ (specs/assets.md) — the seeded art " +
      `drawn on that tile was ${matches.map(frameName).join(", ") || "none"}`,
  );
});
