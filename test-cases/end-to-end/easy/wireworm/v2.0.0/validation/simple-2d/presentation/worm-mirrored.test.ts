// presentation/worm-mirrored — a leftward worm is drawn mirrored.
//
// specs/assets.md, on `assets/worm/`: "The art faces right. A segment of a worm
// whose horizontal heading is left is drawn mirrored horizontally, so the same
// frame serves both directions." A worm reverses its heading every time a step is
// blocked (specs/worm.md), so a build that never mirrors draws a worm crawling
// backwards for half of every level.
//
// THE POINT IS A COMPARISON, and both halves of it are asserted, because
// "mirrored" is a claim about one worm RELATIVE to another: the rightward worm's
// segments must be drawn unflipped — the art already faces right — and the
// leftward worm's flipped. A build that flipped every segment of every worm has
// not drawn a leftward worm mirrored against a rightward one; it has drawn the
// art backwards, and the rightward half of this point is what names that.
//
// THE FLIP IS READ OFF THE TRANSFORM THE CONTEXT HELD AT THE CALL, which is the
// only place the answer is: a build draws a segment by translating to its tile
// centre and drawing the frame about the origin, so a mirror is a negative scale
// on the matrix and never anything in the call's own arguments. The shared
// harness reports it as the sign of the matrix's determinant, so a flip written on
// either axis reads the same.
//
// TWO WORMS, ON TWO ROWS, IN ONE FRAME. Both are read off the same render, so the
// two headings are compared under one animation phase and one board rather than
// across two renders that need not agree. Each is posed with its step held —
// which way a segment faces when it is drawn is not a faculty — so both stand on
// the tiles they were posed on and every draw is attributed to a known tile. The
// board is otherwise the empty, quiet one `startPlaying` opens.

import { afterEach, beforeEach, it } from "vitest";
import { TILE, tileCX, tileCY } from "../../src/constants";
import { assertLength, assertTrue, fail } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  drawnImages,
  poseWorm,
  startPlaying,
  wormOf,
  type Harness,
} from "../harness";
import { drawnAt, spriteReader } from "./reading";

/**
 * How far a draw's destination centre may sit from the segment it is attributed
 * to, in logical units.
 *
 * specs/board.md draws a worm segment centred on its tile, so half a tile
 * (`TILE / 2`, `16`) is the whole of the slack, and it is half the distance to
 * the next segment along, so no draw can be attributed to the wrong segment.
 */
const ATTRIBUTION_MAX = TILE / 2;

/** The two worms: same length, same column for the head, one row each. */
const WORM_LENGTH = 4;
const HEAD_C = 20;
const RIGHTWARD_ROW = 6;
const LEFTWARD_ROW = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the leftward worm's frames mirrored and the rightward worm's not", async () => {
  startPlaying(h);
  const rightward = poseWorm(h, HEAD_C, RIGHTWARD_ROW, WORM_LENGTH, 1, 1);
  const leftward = poseWorm(h, HEAD_C, LEFTWARD_ROW, WORM_LENGTH, -1, 1);
  h.debug.setWormStepping(rightward, false);
  h.debug.setWormStepping(leftward, false);

  const drawn = drawnImages(h, await drawFrame(h));
  captureStill(h, "mirrored");

  const snapshot = h.snapshot();
  const read = spriteReader();

  for (const worm of [
    { id: rightward, heading: 1, mirrored: false, name: "rightward" },
    { id: leftward, heading: -1, mirrored: true, name: "leftward" },
  ]) {
    const held = wormOf(snapshot, worm.id);
    assertLength(
      held.segments,
      WORM_LENGTH,
      `the segments the ${worm.name} worm still holds, none of which anything ` +
        "has removed (specs/instrumentation.md)",
    );
    assertTrue(
      held.dh === worm.heading,
      `the ${worm.name} worm's horizontal heading, as setWormHeading posed it ` +
        "(specs/instrumentation.md)",
    );

    for (const [index, tile] of held.segments.entries()) {
      const near = drawnAt(
        drawn,
        tileCX(tile.c),
        tileCY(tile.r),
        ATTRIBUTION_MAX,
      );
      const fromArt: boolean[] = [];
      for (const image of near) {
        const match = await read(image.source);
        if (match?.folder === "worm") fromArt.push(image.mirrored);
      }
      if (fromArt.length === 0) {
        fail(
          `segment ${index} of the ${worm.name} worm, on tile (${tile.c}, ` +
            `${tile.r}), drawn from a frame of assets/worm/ — there is no ` +
            "such draw on that tile to read a mirroring off (specs/assets.md)",
          { seededFramesDrawnOnThatTile: 0 },
        );
      }
      assertTrue(
        fromArt.every((flipped) => flipped === worm.mirrored),
        `segment ${index} of the ${worm.name} worm, on tile (${tile.c}, ` +
          `${tile.r}), drawn ${worm.mirrored ? "mirrored" : "unmirrored"} ` +
          "(specs/assets.md: the art faces right, and a segment of a worm " +
          "whose horizontal heading is left is drawn mirrored horizontally) " +
          `— the frames drawn there were ${fromArt.length === 0 ? "none" : ""}` +
          fromArt.map((f) => (f ? "mirrored" : "unmirrored")).join(", "),
      );
    }
  }
});
