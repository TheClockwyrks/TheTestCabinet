// Wireworm — presentation/worm-mirrored: a leftward worm is drawn mirrored.
//
// specs/assets.md, on the worm's six frames: "The art faces right. A segment of
// a worm whose horizontal heading is left is drawn mirrored horizontally, so the
// same frame serves both directions." That is one rule with two halves, and both
// are read here because they are the same requirement: the mirroring is KEYED TO
// THE HEADING. A build that never mirrors draws a worm crawling backwards down
// the board; a build that always mirrors draws one crawling backwards half the
// time. Neither is what the file states.
//
// THE READING IS THE TRANSFORM THE BLIT WAS MADE UNDER, not the pixels. A
// mirrored draw states its destination rectangle in a flipped space, and the
// transform recorded beside the call is what maps it back — so a mirrored sprite
// and an upright one both report the centre they were drawn on, and the mirrored
// one reports a reflection. That is exactly the reading the rule asks for,
// whatever the build's art or scale, and it holds for a build that mirrors with
// a negative scale about the sprite's own centre as much as one that mirrors
// about anything else.
//
// THE SAME WORM IS POSED TWICE, once heading right and once heading left, on the
// same tiles of the same otherwise empty board. Its step is off both times, so
// what changed between the two readings is the heading and nothing else. Every
// segment is read, because the file states the rule of "a segment" rather than
// of the head.

import { afterEach, beforeEach, it } from "vitest";
import { TILE } from "../constants";
import { assertEqual, assertGreaterThan, fail } from "../assert";
import {
  captureStill,
  createHarness,
  drawnImages,
  poseWorm,
  resetTo,
  startPlaying,
  tileCenter,
  wormById,
  type DrawnImage,
  type Harness,
} from "../harness";

/** How far a blit's centre may sit from the tile it is drawn on: half a tile. */
const PLACED_MAX = TILE / 2;

/** The worm: three segments along one mid-board row. */
const HEAD_COLUMN = 10;
const WORM_ROW = 6;
const WORM_LENGTH = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * Lay a worm of `WORM_LENGTH` segments heading `dh`, run one frame, and hand
 * back the bitmaps blitted on each of its segments' tiles.
 *
 * The worm is laid so its BODY occupies the same three tiles whichever way it
 * heads — the head at the right-hand end when it heads left, at the left-hand
 * end when it heads right — so the two readings are of the same three tiles.
 */
async function blitsOnSegments(dh: number): Promise<DrawnImage[][]> {
  h.debug.clearWorms();
  const head = dh > 0 ? HEAD_COLUMN : HEAD_COLUMN - (WORM_LENGTH - 1);
  const worm = poseWorm(h, head, WORM_ROW, WORM_LENGTH, dh);
  h.debug.setWormStepping(worm, false);

  h.calls.length = 0;
  await h.advance(1);
  const blits = drawnImages(h);

  const posed = wormById(h.snapshot(), worm);
  assertEqual(
    posed?.dh,
    dh,
    `the posed worm heads ${dh > 0 ? "right" : "left"}`,
  );
  assertEqual(
    posed?.segments.length,
    WORM_LENGTH,
    "the posed worm holds three segments",
  );
  return (posed?.segments ?? []).map((segment) => {
    const centre = tileCenter(segment.c, segment.r);
    return blits.filter(
      (blit) => Math.hypot(blit.x - centre.x, blit.y - centre.y) <= PLACED_MAX,
    );
  });
}

it("mirrors a worm heading left and leaves one heading right upright", async () => {
  resetTo(h);
  startPlaying(h);

  const rightward = await blitsOnSegments(1);
  // The rightward worm, drawn from art that faces right.
  captureStill(h, "mirrored");
  rightward.forEach((onTile, index) => {
    assertGreaterThan(
      onTile.length,
      0,
      `a bitmap blitted on segment ${index} of the rightward worm`,
    );
    if (onTile.some((blit) => blit.mirrored)) {
      fail(
        `segment ${index} of a worm heading RIGHT to be drawn upright, since ` +
          `the seeded art already faces right (specs/assets.md)`,
        "it was blitted under a mirroring transform",
      );
    }
  });

  const leftward = await blitsOnSegments(-1);
  leftward.forEach((onTile, index) => {
    assertGreaterThan(
      onTile.length,
      0,
      `a bitmap blitted on segment ${index} of the leftward worm`,
    );
    if (onTile.every((blit) => !blit.mirrored)) {
      fail(
        `segment ${index} of a worm heading LEFT to be drawn mirrored ` +
          `horizontally (specs/assets.md: the art faces right, and a segment ` +
          `of a worm whose horizontal heading is left is drawn mirrored ` +
          `horizontally, so the same frame serves both directions)`,
        `${onTile.length} bitmap(s) blitted on that tile, none of them ` +
          `mirrored`,
      );
    }
  });
});
