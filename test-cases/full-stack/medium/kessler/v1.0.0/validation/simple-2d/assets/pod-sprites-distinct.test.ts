// assets/pod-sprites-distinct — the five pod sprites are five images rather
// than one shipped five times.
//
// WHAT THE SPECIFICATION FIXES. `specs/assets.md` gives each of the five pod
// kinds its own sprite file and states the bar the set is held to: "The five
// pod kinds are told apart from each other at 24 pixels, in flight, without
// reading a label." Five kinds a player tells apart are five different images,
// and the review item words the floor this point reads: "each pair differs on
// a measurable share of its pixels, so one sprite has not been shipped five
// times."
//
// WHAT IS READ, AND THE FIGURE. Each of the ten pairs the five sprites make,
// compared pixel for pixel, against `DIFFER_MIN_SHARE`: one hundredth of the
// canvas, six pixels of a `24 x 24`, the smallest share worth calling
// measurable. One file shipped twice differs by exactly nothing, since a PNG
// carries its pixels losslessly, so what the floor separates is five sprites
// from one file copied. Whether two sprites differ ENOUGH to tell apart in
// flight is the art bar and the presentation domain's aesthetic rating.
//
// This decides only that the five differ. That each exists, is 24 x 24, and
// carries paint is `assets/pod-sprites-produced`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, fail } from "../assert";
import { captureStill, openHarness, type Harness } from "../harness";
import {
  decodeSprites,
  DIFFER_MIN_SHARE,
  differingShare,
  POD_FILES,
  showSpriteFiles,
  type Sprite,
} from "./sprites";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws each of the five pod sprites differently from the rest", async () => {
  const read = await decodeSprites(POD_FILES);
  await showSpriteFiles(h, POD_FILES);
  captureStill(h, "sprites");

  const sprites: Sprite[] = [];
  for (let i = 0; i < POD_FILES.length; i += 1) {
    const { sprite, reason } = read[i];
    if (sprite === null) fail(`a decodable image at ${POD_FILES[i]}`, reason);
    sprites.push(sprite);
  }

  for (let a = 0; a < sprites.length; a += 1) {
    for (let b = a + 1; b < sprites.length; b += 1) {
      assertGreaterThanOrEqual(
        differingShare(sprites[a], sprites[b]),
        DIFFER_MIN_SHARE,
        `the share of pixels differing between ${sprites[a].file} and ${sprites[b].file}`,
      );
    }
  }
});
