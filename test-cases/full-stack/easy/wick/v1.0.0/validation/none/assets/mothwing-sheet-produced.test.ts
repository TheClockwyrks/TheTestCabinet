// assets/mothwing-sheet-produced — the Mothwing elite ships four painted frames
// on its 56-pixel canvas, no two the same.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The sprites") gives the row
// "Mothwing | `assets/sprites/enemies/mothwing/0.png` to `3.png` | `draw-sheet`
// | `4` | `56 x 56`", under "A sheet's frames are separate PNG files, numbered
// from `0`, each on a canvas of the sheet's size" and "Every sprite is pixel art
// drawn at one unit per pixel on a transparent, straight-alpha canvas of exactly
// the size its row states". `draw-sheet` is the tool for "everything that moves
// on its own: the walk cycles", and the sheet is played as motion — "An enemy
// draws frame `floor(age / WALK_FRAME_TIME) mod 4` of its sheet for as long as it
// lives" — so a frame a player has already seen is a step with no movement in it.
//
// THE TOLERANCES. The four paths and the `56 x 56` canvas are exact figures and
// are read exactly. That each file carries a drawing rather than an empty canvas
// is read against `PAINT_MIN_SHARE`, whose reasoning `assets/sprites.ts` states.
// That no two frames are the same picture needs none: a PNG carries its pixels
// losslessly, so two files holding one picture differ on exactly nothing.
//
// WHAT IT DELIBERATELY DOES NOT READ. That this sheet differs from the other
// twelve enemies' is `assets/enemy-sheets-distinct`; that the elite "reads as
// larger and heavier than the commons" beyond its canvas is the art bar.
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
const FRAMES = enemySheet("mothwing");

it("ships four distinct, painted 56 x 56 mothwing frames", async () => {
  const read = await decodeSprites(FRAMES);
  writeImage(
    "mothwing",
    await paintSprites("The mothwing frames", FRAMES, {
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
