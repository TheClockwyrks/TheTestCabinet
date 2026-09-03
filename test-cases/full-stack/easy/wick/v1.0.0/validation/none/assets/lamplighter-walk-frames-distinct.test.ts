// assets/lamplighter-walk-frames-distinct — the walk sheet is six poses of a
// stride rather than one frame shipped six times.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The tools") puts
// `draw-sheet` behind "everything that moves on its own: the walk cycles, the
// death puff, and the animated effects", and the sheet is played as motion: "The
// walk frame is `floor(m x TICK_DT / WALK_FRAME_TIME) mod 6` ... so the cycle
// advances one frame per `WALK_FRAME_TIME` seconds of movement and wraps." A
// cycle that advances onto a frame a player has already seen shows no movement
// for that step, so the review item words the floor this point reads: no two of
// the six frames are pixel-identical.
//
// THE TOLERANCE. None, and none is needed: a PNG carries its pixels losslessly,
// so two files holding one picture differ on exactly nothing, and one differing
// pixel is the whole distance between six poses and one file copied. Two fully
// transparent pixels count as the same pixel whatever colour bytes sit under
// them, since a straight-alpha canvas leaves those invisible.
//
// WHAT IT DELIBERATELY DOES NOT READ. That each frame exists on its `24 x 32`
// canvas and carries paint is `assets/lamplighter-walk-produced`; whether the
// six read as one continuous stride is the art bar and the presentation domain's
// aesthetic rating.
//
// THE DRIVE. None. This point is about FILES, so it reads the repository the
// build produced and drives no game.

import { it } from "vitest";
import { writeImage } from "./media-out";
import {
  assertAllDistinct,
  decodeAll,
  paintSprites,
  WALK_SPRITES,
} from "./sprites";

it("draws each of the six walk frames differently from the rest", async () => {
  // Painted before anything is read, so a file that will not decode still leaves
  // the picture that shows what the build shipped.
  writeImage(
    "distinct",
    await paintSprites("The walk frames side by side", WALK_SPRITES, {
      checker: true,
      columns: 6,
      cell: 128,
    }),
  );

  assertAllDistinct(await decodeAll(WALK_SPRITES));
});
