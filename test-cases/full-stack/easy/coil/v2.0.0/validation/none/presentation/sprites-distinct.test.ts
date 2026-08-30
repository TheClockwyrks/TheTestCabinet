// presentation/sprites-distinct — the straight, corner and tail sprites are
// three sprites rather than one shipped three times.
//
// WHAT THE SPECIFICATION FIXES. `specs/assets.md` gives each of the three its
// own piece and its own authored facing: the straight body "a horizontal run",
// the corner "the bend whose two neighbors lie to the right and below", the tail
// "its one neighbor lying to the right". The table beside them assigns a cell to
// each — a straight run, a bend, and the last cell of the chain — and states the
// bar the set is held to: "a body cell is never drawn as a bare square, and a
// turning snake reads as one continuous coil rather than as a staircase." Three
// pieces are three images, and a build that ships one of them three times paints
// a bend with a straight.
//
// WHAT IS READ, AND THE FIGURE. Each of the three pairs, compared pixel for
// pixel, against `DIFFER_MIN_PIXELS`: four pixels, the smallest square mark a
// player sees at one cell. One sprite shipped twice differs by exactly nothing,
// since a PNG carries its pixels losslessly, so what the floor really separates
// is three pieces from one file copied. Whether the three JOIN without a seam,
// which the same file asks for, is the presentation domain's aesthetic rating.
//
// This decides only that the three differ as files. That the build paints the
// right one on the right cell is `presentation/corner-at-a-bend` and
// `presentation/tail-at-the-last-cell`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, fail } from "../assert";
import { BODY_FILES } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  DIFFER_MIN_PIXELS,
  decodeSprites,
  differingPixels,
  showSpriteFiles,
  type Sprite,
} from "./sprites";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the straight, corner and tail sprites differently", async () => {
  const read = await decodeSprites(h, BODY_FILES);
  await showSpriteFiles(h, BODY_FILES);
  await captureStill(h, "sprites");

  const sprites: Sprite[] = [];
  for (let i = 0; i < BODY_FILES.length; i += 1) {
    const { sprite, reason } = read[i];
    if (sprite === null) fail(`a decodable image at ${BODY_FILES[i]}`, reason);
    sprites.push(sprite);
  }

  for (let a = 0; a < sprites.length; a += 1) {
    for (let b = a + 1; b < sprites.length; b += 1) {
      assertGreaterThanOrEqual(
        differingPixels(sprites[a], sprites[b]),
        DIFFER_MIN_PIXELS,
        `the pixels differing between ${sprites[a].file} and ${sprites[b].file}`,
      );
    }
  }
});
