// presentation/head-frames-distinct — the head sheet is a set of poses rather
// than one frame shipped over and over.
//
// WHAT THE SPECIFICATION FIXES. `specs/assets.md` names each frame of the head
// sheet: `0` is "at rest, mouth closed", `1` "mouth opening", `2` "mouth wide",
// and `3` "mouth closing". It states the bar for them too — "the bite is legible
// at eight ticks a second. Frame `2` is a visibly open mouth rather than a
// shifted pixel, and the three frames read as one motion." A sheet that ships
// one picture under several names cannot show the bite
// `presentation/bite-starts-on-eat` looks for.
//
// WHY `1` AND `3` ARE NOT COMPARED WITH EACH OTHER. They are the one pair
// `specs/assets.md` names at the same aperture: `1` is the mouth on its way
// open and `3` is the same mouth on its way shut. A bite drawn symmetrically —
// out through `2` and back along the way it came — is one motion played from
// three frames of which two are deliberately the same picture, and it reads as
// a bite on the board: at rest, half open, wide, half open, at rest. Nothing in
// `specs/assets.md` asks the closing pose to differ from the opening one, so a
// check demanding it would fail honest pixel art over a choice the
// specification left to the build.
//
// WHAT IS READ. The five pairs the specification does fix — every pair but `1`
// against `3` — compared pixel for pixel. A PNG carries its pixels losslessly
// and every file comes off the same disk in the same process, so one frame
// shipped twice differs on exactly nothing and two poses differ on something.
// How MUCH two poses differ, and whether the motion reads as one bite, is the
// presentation domain's aesthetic rating rather than a figure a check can hold
// a build to.
//
// This decides only that those five differ. That each exists, is cell-sized,
// and carries paint is `presentation/head-frames-produced`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, fail } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  decodeSprites,
  differingPixels,
  HEAD_FILES,
  showSpriteFiles,
  type Sprite,
} from "./sprites";

/**
 * The frame pairs `specs/assets.md` fixes as different pictures.
 *
 * Every pair the four frames make but `1` against `3`, the one pair the
 * specification names at a single aperture — see the note at the top of this
 * file.
 */
const DISTINCT_PAIRS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 2],
  [2, 3],
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the head sheet as distinct poses, not one frame repeated", async () => {
  const read = await decodeSprites(HEAD_FILES);
  await showSpriteFiles(h, HEAD_FILES);
  captureStill(h, "sheet");

  const frames: Sprite[] = [];
  for (let frame = 0; frame < HEAD_FILES.length; frame += 1) {
    const { sprite, reason } = read[frame];
    if (sprite === null)
      fail(`a decodable image at ${HEAD_FILES[frame]}`, reason);
    frames.push(sprite);
  }

  for (const [a, b] of DISTINCT_PAIRS) {
    assertGreaterThan(
      differingPixels(frames[a], frames[b]),
      0,
      `the pixels differing between ${frames[a].file} and ${frames[b].file}`,
    );
  }
});
