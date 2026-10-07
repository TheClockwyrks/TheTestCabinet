// assets/enemy-sheets-distinct — the thirteen enemies are thirteen different
// creatures rather than one sheet shipped under several names.
//
// WHAT THIS DECIDES. That no two of the thirteen enemies' `0.png` frames are
// the same picture: the ten commons, the two elites, and the Dark.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The sprites"): "Every
// enemy is told from every other at a glance, by silhouette and not by hue
// alone, and the two elites and the Dark read as larger and heavier than the
// commons." Two enemies drawn as the same picture are told apart by nothing
// at all, so pixel identity is the floor that sentence puts under the roster.
// Whether two different pictures are different ENOUGH to tell apart in a
// crowd is the art bar and the presentation domain's aesthetic rating, which
// is a person's to make.
//
// WHY THE FIRST FRAME. One frame per enemy is what the comparison is about —
// the creature, not its cycle — and `0.png` is the frame every sheet holds
// (`specs/assets.md`: "A sheet's frames are separate PNG files, numbered from
// `0`"). Two enemies whose first frames differ are two creatures; that each
// sheet's own frames differ is the frames-distinct points.
//
// WHY NO WORLD IS POSED. This point is about FILES rather than about a frame,
// so the game is never driven. A harness is opened only to own the canvas the
// evidence picture is painted on, and the picture is the thirteen first
// frames side by side.
//
// THE TOLERANCE. `PIXEL_CHANNEL_EPS`, eight levels of 255 per channel. Two
// enemies drawn on different squares are already two different pictures,
// since no pixel of one is the pixel of the other.

import { afterEach, beforeEach, it } from "vitest";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  assertNoTwoIdentical,
  ENEMY_FIRST_FRAMES,
  readSprites,
  requireImages,
  showSprites,
} from "./produced";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws each of the thirteen enemies as a different picture", async () => {
  const reads = await readSprites(ENEMY_FIRST_FRAMES);
  await showSprites(h, ENEMY_FIRST_FRAMES);
  captureStill(h, "roster");

  const frames = requireImages(reads);
  assertNoTwoIdentical(
    frames,
    ENEMY_FIRST_FRAMES.map((sprite) => sprite.path),
  );
});
