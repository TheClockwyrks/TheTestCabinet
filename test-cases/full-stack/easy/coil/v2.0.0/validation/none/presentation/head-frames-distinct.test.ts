// presentation/head-frames-distinct — the head sheet is four poses rather than
// one frame shipped four times.
//
// WHAT THE SPECIFICATION FIXES. `specs/assets.md` names each frame of the head
// sheet: `0` is "at rest, mouth closed", `1` "mouth opening", `2` "mouth wide",
// and `3` "mouth closing". It states the bar for them too — "the bite is legible
// at eight ticks a second. Frame `2` is a visibly open mouth rather than a
// shifted pixel, and the three frames read as one motion." Four named poses are
// four different images, and a sheet that repeats one of them cannot show the
// bite `presentation/bite-starts-on-eat` looks for.
//
// WHAT IS READ. Each of the six pairs the four frames make, compared pixel for
// pixel. A PNG carries its pixels losslessly and every file comes off the same
// disk in the same process, so one frame shipped twice differs on exactly
// nothing and two poses differ on something. How MUCH two poses differ, and
// whether the motion reads as one bite, is the presentation domain's aesthetic
// rating rather than a figure a check can hold a build to.
//
// This decides only that the four differ. That each exists, is cell-sized, and
// carries paint is `presentation/head-frames-produced`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, fail } from "../assert";
import { HEAD_FILES } from "../constants";
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

it("draws each of the four head frames differently from the rest", async () => {
  const read = await decodeSprites(h, HEAD_FILES);
  await showSpriteFiles(h, HEAD_FILES);
  await captureStill(h, "sheet");

  const frames: Sprite[] = [];
  for (let frame = 0; frame < HEAD_FILES.length; frame += 1) {
    const { sprite, reason } = read[frame];
    if (sprite === null)
      fail(`a decodable image at ${HEAD_FILES[frame]}`, reason);
    frames.push(sprite);
  }

  for (let a = 0; a < frames.length; a += 1) {
    for (let b = a + 1; b < frames.length; b += 1) {
      assertGreaterThan(
        differingPixels(frames[a], frames[b]),
        0,
        `the pixels differing between ${frames[a].file} and ${frames[b].file}`,
      );
    }
  }
});
