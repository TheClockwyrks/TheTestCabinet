// assets/dark-sheet-produced — the Dark ships four painted frames on its
// 80-pixel canvas, no two the same.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The sprites") gives the row
// "The Dark | `assets/sprites/enemies/dark/0.png` to `3.png` | `draw-sheet` |
// `4` | `80 x 80`", under "A sheet's frames are separate PNG files, numbered from
// `0`, each on a canvas of the sheet's size" and "Every sprite is pixel art drawn
// at one unit per pixel on a transparent, straight-alpha canvas of exactly the
// size its row states". `draw-sheet` is the tool for "everything that moves on
// its own: the walk cycles", and the sheet is played as motion — "An enemy draws
// frame `floor(age / WALK_FRAME_TIME) mod 4` of its sheet for as long as it
// lives" — so a frame a player has already seen is a step with no movement in it.
//
// THE TOLERANCES. The four paths and the `80 x 80` canvas are exact figures and
// are read exactly. That each file carries a drawing rather than an empty canvas
// is read against `PAINT_MIN_SHARE`, whose reasoning `assets/sprites.ts` states.
// That no two frames are the same picture needs none: a PNG carries its pixels
// losslessly, so two files holding one picture differ on exactly nothing.
//
// WHAT IT DELIBERATELY DOES NOT READ. That this sheet differs from the other
// twelve enemies' is `assets/enemy-sheets-distinct`.
//
// THE DRIVE. None. This point is about FILES, so it reads the repository the
// build produced and drives no game.

import { it } from "vitest";
import { writeImage } from "./media-out";
import {
  assertAllDistinct,
  assertProducedAt,
  decodeAll,
  decodeSprites,
  enemySheet,
  paintSprites,
} from "./sprites";

/** The sheet's four frames, at the paths and canvas its row fixes. */
const FRAMES = enemySheet("dark");

it("ships four distinct, painted 80 x 80 frames of the Dark", async () => {
  const read = await decodeSprites(FRAMES);
  writeImage(
    "dark",
    await paintSprites("The Dark's frames", FRAMES, {
      checker: true,
      columns: 4,
      cell: 128,
    }),
  );

  for (const [index, frame] of FRAMES.entries()) {
    assertProducedAt(frame, read[index]!);
  }
  assertAllDistinct(await decodeAll(FRAMES));
});
