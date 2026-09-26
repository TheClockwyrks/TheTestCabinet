// assets/puff-sheet-produced — the death puff ships four painted frames on
// its 24-pixel square, no two of them the same picture.
//
// WHAT THIS DECIDES. Four files: `assets/sprites/puff/0.png` through `3.png`
// are committed, decode, sit on exactly `24 x 24`, each carries
// non-transparent paint, and no two of the four are the same picture.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The sprites"): the row
// "Death puff, shared by every enemy" puts it at
// "`assets/sprites/puff/0.png` to `3.png`", produced with `draw-sheet`, `4`
// frames, on `24 x 24`, and the paragraph above it fixes the canvas exactly
// and states that a sheet's frames are separate PNG files numbered from `0`.
// The four differing comes from the same sheet's own description:
// `draw-sheet` produces "everything that moves on its own: the walk cycles,
// the death puff, and the animated effects", and ("Animation") "The death
// puff is drawn centered on the position an enemy died at, frame
// `floor(t / (PUFF_TIME / 4))` for `t` the seconds of ticks since the tick it
// died", which plays through nothing when the four are one picture.
// `PUFF_SHEET` and `PUFF_SPRITE_SIZE` in `src/constants.ts` are those
// figures.
//
// WHAT IT DELIBERATELY DOES NOT READ. That the game draws the puff where an
// enemy died, for `PUFF_TIME`, and that it damages nothing, belongs to the
// enemies' own points.
//
// WHY NO WORLD IS POSED. This point is about FILES rather than about a frame,
// so the game is never driven. A harness is opened only to own the canvas the
// evidence picture is painted on, and the picture is the four frames.
//
// THE TOLERANCE. The canvas is exact, because the specification states it
// exactly; the paint reading is presence, at least one pixel not clear; and
// two frames are the same picture within `PIXEL_CHANNEL_EPS`, eight levels of
// 255 per channel.

import { afterEach, beforeEach, it } from "vitest";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  assertNoTwoIdentical,
  assertProduced,
  PUFF_FRAMES,
  readSprites,
  showSprites,
} from "./produced";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("commits four painted 24 x 24 puff frames, no two alike", async () => {
  const reads = await readSprites(PUFF_FRAMES);
  await showSprites(h, PUFF_FRAMES);
  captureStill(h, "puff");

  const frames = assertProduced(reads);
  assertNoTwoIdentical(
    frames,
    PUFF_FRAMES.map((sprite) => sprite.path),
  );
});
