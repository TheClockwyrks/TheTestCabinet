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
// same three tiles of the same otherwise empty board. Its step is off both
// times, so what changed between the two readings is the heading and nothing
// else. Every segment is read, because the file states the rule of "a segment"
// rather than of the head.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, fail } from "../assert";
import { TILE, tileCX, tileCY } from "../constants";
import {
  blitsOfFrame,
  captureStill,
  createHarness,
  drawnFrom,
  poseWorm,
  startPlaying,
  wormById,
  type Blit,
  type Harness,
} from "../harness";

/**
 * How far a blit's centre may sit from the tile it is drawn on, in logical
 * units.
 *
 * Half a tile. specs/board.md draws a worm segment "centered on" its tile's
 * centre, and how a build inks the frame inside that tile is its own; a blit
 * whose centre left the tile altogether is drawn on a different tile.
 */
const PLACED_MAX = TILE / 2;

/** The three tiles the worm occupies, whichever way it heads. */
const WORM_ROW = 6;
const LEFT_COLUMN = 8;
const WORM_LENGTH = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

/**
 * Lay a worm of `WORM_LENGTH` segments heading `dh` on those three tiles, run
 * one frame, and hand back the seeded worm frames blitted on each of them.
 *
 * The head goes at the right-hand end when the worm heads right and at the
 * left-hand end when it heads left, since `poseWorm` trails the rest of the
 * chain behind the head, so the three tiles are the same three either way.
 */
async function wormBlits(dh: number): Promise<Blit[][]> {
  await h.debug.clearWorms();
  const head = dh > 0 ? LEFT_COLUMN + WORM_LENGTH - 1 : LEFT_COLUMN;
  const id = await poseWorm(h, {
    c: head,
    r: WORM_ROW,
    length: WORM_LENGTH,
    dh,
    stepping: false,
  });

  const blits = await blitsOfFrame(h);
  const posed = wormById(await h.snapshot(), id);
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
  return (posed?.segments ?? []).map((segment) =>
    drawnFrom(
      blits,
      "worm",
      { x: tileCX(segment.c), y: tileCY(segment.r) },
      PLACED_MAX,
    ),
  );
}

it("mirrors a worm heading left and leaves one heading right upright", async () => {
  await startPlaying(h);

  const rightward = await wormBlits(1);
  // The rightward worm, drawn from art that already faces right.
  await captureStill(h, "mirrored");
  for (const [index, onTile] of rightward.entries()) {
    assertGreaterThan(
      onTile.length,
      0,
      `a frame of assets/worm/ blitted on segment ${index} of the rightward ` +
        `worm`,
    );
    if (onTile.some((blit) => blit.flipX)) {
      fail(
        `segment ${index} of a worm heading RIGHT to be drawn upright, since ` +
          `the seeded art already faces right (specs/assets.md)`,
        "it was blitted under a horizontally mirroring transform",
      );
    }
  }

  const leftward = await wormBlits(-1);
  for (const [index, onTile] of leftward.entries()) {
    assertGreaterThan(
      onTile.length,
      0,
      `a frame of assets/worm/ blitted on segment ${index} of the leftward worm`,
    );
    if (onTile.every((blit) => !blit.flipX)) {
      fail(
        `segment ${index} of a worm heading LEFT to be drawn mirrored ` +
          `horizontally (specs/assets.md: the art faces right, and a segment ` +
          `of a worm whose horizontal heading is left is drawn mirrored ` +
          `horizontally, so the same frame serves both directions)`,
        `${onTile.length} frame(s) of assets/worm/ blitted on that tile, none ` +
          `of them mirrored`,
      );
    }
  }
});
