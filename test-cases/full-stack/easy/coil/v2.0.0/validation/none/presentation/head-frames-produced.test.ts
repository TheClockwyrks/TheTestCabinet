// presentation/head-frames-produced — the four head frames are on disk, at the
// size a cell is, and each carries paint.
//
// WHAT THE SPECIFICATION FIXES. `specs/assets.md` puts the head sheet at
// `assets/snake/head/0.png` through `3.png`, `HEAD_FRAMES` (`4`) frames "produced
// with `draw-sheet` and emitted as separate files rather than as regions of one
// image", each "pixel art on a transparent, straight-alpha canvas of `CELL x CELL`
// (`32 x 32`), so one sprite covers exactly one board cell". Those three
// statements — the four paths, the square, and a drawn frame rather than an
// empty one — are what this reads.
//
// WHAT IT DELIBERATELY DOES NOT READ. What the frames look like, or that they
// differ from one another: the first is the presentation domain's aesthetic
// rating and the second is `presentation/head-frames-distinct`. This point is
// only that the four files were produced.
//
// HOW A FILE IS READ. Off the repository the build produced, at the path
// `specs/assets.md` fixes, and decoded by the browser rather than by a decoder
// written here — see `presentation/sprites.ts` for why. The evidence is a
// picture of the four files themselves, since this point drives no game.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, fail } from "../assert";
import { CELL, HEAD_FILES, HEAD_FRAMES } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  decodeSprites,
  isCellSized,
  paintShare,
  showSpriteFiles,
} from "./sprites";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ships four head frames, each a painted cell-sized square", async () => {
  const read = await decodeSprites(h, HEAD_FILES);
  await showSpriteFiles(h, HEAD_FILES);
  await captureStill(h, "sheet");

  assertEqual(HEAD_FILES.length, HEAD_FRAMES, "head frames the sheet declares");

  for (let frame = 0; frame < HEAD_FILES.length; frame += 1) {
    const file = HEAD_FILES[frame];
    const { sprite, reason } = read[frame];
    if (sprite === null) {
      fail(`a decodable image at ${file}`, reason);
    }
    if (!isCellSized(sprite)) {
      fail(
        `${file} at CELL x CELL (${CELL} x ${CELL})`,
        `${sprite.width} x ${sprite.height}`,
      );
    }
    assertGreaterThan(
      paintShare(sprite),
      0,
      `the share of ${file} carrying paint`,
    );
  }
});
