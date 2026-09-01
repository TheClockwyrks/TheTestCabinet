// assets/common-enemy-frames-distinct — each common enemy's sheet is four poses
// of a walk rather than one frame shipped four times.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The tools") puts
// `draw-sheet` behind "everything that moves on its own: the walk cycles, the
// death puff, and the animated effects", and a sheet is played as motion: "An
// enemy draws frame `floor(age / WALK_FRAME_TIME) mod 4` of its sheet for as long
// as it lives." A cycle that advances onto a frame a player has already seen
// shows no movement for that step, so the review item words the floor this point
// reads: within each of the ten common sheets, no two of its four frames are
// pixel-identical.
//
// THE TOLERANCE. None, and none is needed: a PNG carries its pixels losslessly,
// so two files holding one picture differ on exactly nothing, and one differing
// pixel is the whole distance between four poses and one file copied.
//
// WHAT IT DELIBERATELY DOES NOT READ. Each frame's existence and canvas is
// `assets/common-enemy-sheets-produced`; that one enemy's sheet differs from
// another's is `assets/enemy-sheets-distinct`.
//
// THE DRIVE. None. This point is about FILES, so it reads the repository the
// build produced and drives no game.

import { it } from "vitest";
import { writeImage } from "./media-out";
import {
  assertAllDistinct,
  COMMON_SHEETS,
  decodeAll,
  paintSprites,
} from "./sprites";

it("draws each common enemy's four frames differently from one another", async () => {
  // Painted before anything is read, so a file that will not decode still leaves
  // the picture that shows what the build shipped.
  writeImage(
    "distinct",
    await paintSprites("The common frames side by side", COMMON_SHEETS.flat(), {
      checker: true,
      columns: 4,
      cell: 96,
    }),
  );

  for (const sheet of COMMON_SHEETS) {
    assertAllDistinct(await decodeAll(sheet));
  }
});
