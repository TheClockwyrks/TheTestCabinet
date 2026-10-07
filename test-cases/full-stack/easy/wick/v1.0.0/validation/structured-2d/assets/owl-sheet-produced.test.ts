// assets/owl-sheet-produced — the owl's sheet ships four painted frames
// on its 72-pixel square, no two of them the same picture.
//
// WHAT THIS DECIDES. Four files: `assets/sprites/enemies/owl/0.png`
// through `3.png` are committed, decode, sit on exactly `72 x 72`,
// each carries non-transparent paint, and no two of the four are the same
// picture.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The sprites"): the table
// row "Owl" puts the sheet at
// "`assets/sprites/enemies/owl/0.png` to `3.png`", produced with
// `draw-sheet`, `4` frames, on a `72 x 72` canvas, and the paragraph
// above it fixes the canvas exactly and states that "A sheet's frames are
// separate PNG files, numbered from `0`". The four differing comes from the
// same sheet's own description: `draw-sheet` produces "everything that moves
// on its own: the walk cycles, the death puff, and the animated effects", and
// ("Animation") "An enemy draws frame `floor(age / WALK_FRAME_TIME) mod 4` of
// its sheet for as long as it lives", which steps through nothing when the
// four are one picture. `ENEMIES.owl.radius` in `src/constants.ts` is
// half that square.
//
// WHAT IT DELIBERATELY DOES NOT READ. That the owl's sheet differs from the
// other twelve enemies' is `assets/enemy-sheets-distinct`; whether it "reads
// as larger and heavier than the commons" is the art bar and the presentation
// domain's aesthetic rating; and that the game draws an owl from the sheet
// belongs to the enemies' presentation points.
//
// WHY NO WORLD IS POSED. This point is about FILES rather than about a frame,
// so the game is never driven. A harness is opened only to own the canvas the
// evidence picture is painted on, and the picture is the four frames.
//
// THE TOLERANCE. The canvas is exact, because the specification states it
// exactly; the paint reading is presence, at least one pixel not clear; and
// two frames are the same picture within `PIXEL_CHANNEL_EPS`, eight levels of
// 255 per channel, which a losslessly stored duplicate lands inside and no
// visible difference hides under.

import { afterEach, beforeEach, it } from "vitest";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  assertNoTwoIdentical,
  assertProduced,
  enemySheet,
  readSprites,
  showSprites,
} from "./produced";

const FRAMES = enemySheet("owl");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("commits four painted 72 x 72 frames for the owl, no two alike", async () => {
  const reads = await readSprites(FRAMES);
  await showSprites(h, FRAMES);
  captureStill(h, "owl");

  const frames = assertProduced(reads);
  assertNoTwoIdentical(
    frames,
    FRAMES.map((sprite) => sprite.path),
  );
});
