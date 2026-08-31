// assets/ball-frames-distinct — the ball sheet is six poses of a spin rather
// than one frame shipped six times.
//
// WHAT THE SPECIFICATION FIXES. `specs/assets.md` gives the sheet six frames
// that "play `0` through `5` in order and wrap, advancing one frame per 5
// ticks of simulation time", and holds them to "read as one continuous spin
// rather than a flicker". A spin is motion, and motion needs frames that
// differ; the review item words the floor this point reads: "each pair differs
// on a measurable share of its pixels, so the sheet is a spin rather than one
// frame repeated."
//
// WHAT IS READ, AND THE FIGURE. Each of the fifteen pairs the six frames make,
// compared pixel for pixel, against `DIFFER_MIN_SHARE`: one hundredth of the
// canvas, six pixels of a `24 x 24`, the smallest share worth calling
// measurable. One frame shipped twice differs by exactly nothing, since a PNG
// carries its pixels losslessly, so what the floor separates is six poses from
// one file copied. Whether the six read as ONE CONTINUOUS spin is the art bar
// and the presentation domain's aesthetic rating.
//
// This decides only that the six differ. That each exists, is 24 x 24, and
// carries paint is `assets/ball-frames-produced`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, fail } from "../assert";
import { captureStill, openHarness, type Harness } from "../harness";
import {
  BALL_FILES,
  decodeSprites,
  DIFFER_MIN_SHARE,
  differingShare,
  showSpriteFiles,
  type Sprite,
} from "./sprites";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws each of the six ball frames differently from the rest", async () => {
  const read = await decodeSprites(h, BALL_FILES);
  await showSpriteFiles(h, BALL_FILES);
  await captureStill(h, "sheet");

  const frames: Sprite[] = [];
  for (let frame = 0; frame < BALL_FILES.length; frame += 1) {
    const { sprite, reason } = read[frame];
    if (sprite === null)
      fail(`a decodable image at ${BALL_FILES[frame]}`, reason);
    frames.push(sprite);
  }

  for (let a = 0; a < frames.length; a += 1) {
    for (let b = a + 1; b < frames.length; b += 1) {
      assertGreaterThanOrEqual(
        differingShare(frames[a], frames[b]),
        DIFFER_MIN_SHARE,
        `the share of pixels differing between ${frames[a].file} and ${frames[b].file}`,
      );
    }
  }
});
