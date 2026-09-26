// assets/lamplighter-walk-produced — the walk sheet's six frames are on disk as
// separate files, each on its canvas, each with a stride drawn on it.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The sprites") gives the row
// "Lamplighter, walk | `assets/sprites/lamplighter/walk/0.png` to `5.png` |
// `draw-sheet` | `6` | `24 x 32`", and fixes the shape a sheet lands in: "A
// sheet's frames are separate PNG files, numbered from `0`, each on a canvas of
// the sheet's size." The six paths, the exact canvas, and a drawn frame rather
// than an empty one are what this reads, the last as presence: at least one
// pixel of the canvas is not clear.
//
// WHAT IT DELIBERATELY DOES NOT READ. That the six differ from one another is
// `assets/lamplighter-walk-frames-distinct`; that the cycle advances one frame
// per `WALK_FRAME_TIME` of movement is the presentation category's.
//
// THE DRIVE. None. This point is about FILES, so it reads the repository the
// build produced and drives no game.

import { it } from "vitest";
import { writeImage } from "./media-out";
import {
  assertProducedAt,
  decodeSprites,
  paintSprites,
  WALK_SPRITES,
} from "./sprites";

it("ships six walk frames, each a painted 24 x 32 file of its own", async () => {
  const read = await decodeSprites(WALK_SPRITES);
  writeImage(
    "walk",
    await paintSprites("The six walk frames", WALK_SPRITES, {
      checker: true,
      columns: 6,
      cell: 128,
    }),
  );

  for (const [index, frame] of WALK_SPRITES.entries()) {
    assertProducedAt(frame, read[index]!);
  }
});
