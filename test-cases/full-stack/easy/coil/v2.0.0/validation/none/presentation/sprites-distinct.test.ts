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
// WHAT IS READ. Each of the three pairs, compared pixel for pixel. A PNG carries
// its pixels losslessly and both files come off the same disk in the same
// process, so one sprite shipped twice differs on exactly nothing and three
// pieces differ on something. How MUCH two of them differ is not read: the
// specification fixes no figure for it, and whether the three JOIN without a
// seam, which the same file asks for, is the presentation domain's aesthetic
// rating.
//
// This decides only that the three differ as files. That the build paints the
// right one on the right cell is `presentation/corner-at-a-bend` and
// `presentation/tail-at-the-last-cell`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, fail } from "../assert";
import { BODY_FILES } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import {
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
      assertGreaterThan(
        differingPixels(sprites[a], sprites[b]),
        0,
        `the pixels differing between ${sprites[a].file} and ${sprites[b].file}`,
      );
    }
  }
});
