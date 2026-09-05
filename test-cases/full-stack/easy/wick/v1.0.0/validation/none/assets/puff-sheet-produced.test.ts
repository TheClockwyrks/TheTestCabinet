// assets/puff-sheet-produced — the death puff ships four painted frames on its
// 24-pixel canvas, no two the same.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The sprites") gives the row
// "Death puff, shared by every enemy | `assets/sprites/puff/0.png` to `3.png` |
// `draw-sheet` | `4` | `24 x 24`", under "A sheet's frames are separate PNG
// files, numbered from `0`, each on a canvas of the sheet's size". `draw-sheet`
// is the tool for "everything that moves on its own: the walk cycles, the death
// puff, and the animated effects", and the puff is played once through: "The
// death puff is drawn ... frame `floor(t / (PUFF_TIME / 4))` for `t` the seconds
// of ticks since the tick it died, in `[0, PUFF_TIME)`, and is gone after." A
// four-frame burst whose frames repeat holds still for part of its life.
//
// THE TOLERANCES. The four paths and the `24 x 24` canvas are exact figures and
// are read exactly. That each file carries a drawing rather than an empty canvas
// is read as presence: at least one pixel of the canvas is not clear.
// That no two frames are the same picture needs none: a PNG carries its pixels
// losslessly, so two files holding one picture differ on exactly nothing.
//
// WHAT IT DELIBERATELY DOES NOT READ. That the puff is drawn where an enemy died,
// for `PUFF_TIME` and no longer, is the presentation category's, and "it is a
// picture, and it damages nothing" is the enemies category's.
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
  paintSprites,
  PUFF_SPRITES,
} from "./sprites";

it("ships four distinct, painted 24 x 24 puff frames", async () => {
  const read = await decodeSprites(PUFF_SPRITES);
  writeImage(
    "puff",
    await paintSprites("The puff frames", PUFF_SPRITES, {
      checker: true,
      columns: 4,
      cell: 128,
    }),
  );

  for (const [index, frame] of PUFF_SPRITES.entries()) {
    assertProducedAt(frame, read[index]!);
  }
  assertAllDistinct(await decodeAll(PUFF_SPRITES));
});
