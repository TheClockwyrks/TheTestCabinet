// Wick — assets/lamplighter-walk-produced: the walk sheet ships six committed
// frames, each on its stated canvas, each carrying paint.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/assets.md (The sprites): "Lamplighter, walk |
//     `assets/sprites/lamplighter/walk/0.png` to `5.png` | `draw-sheet` | `6` |
//     `24 x 32`", and "A sheet's frames are separate PNG files, numbered from
//     `0`, each on a canvas of the sheet's size."
//   - specs/assets.md (Animation): "The walk frame is
//     `floor(m × TICK_DT / WALK_FRAME_TIME) mod 6`", so the sheet is six frames
//     and the cycle wraps at six.
//   - `constants.ts` carries the directory, the count, and the canvas as
//     `LAMPLIGHTER_WALK_DIR`, `LAMPLIGHTER_WALK_FRAMES`, and the sprite's width
//     and height.
//
// WHAT IS READ. All six files exist as separate files at `0.png` through
// `5.png`, each decodes, each is exactly `24 x 32`, and each carries at least
// one pixel that is not fully transparent.
//
// WHAT IT DELIBERATELY DOES NOT READ. That the six differ from one another is
// `assets/lamplighter-walk-frames-distinct`; which frame is drawn on which tick
// is the lamplighter's own presentation point.
//
// WHY NO NIGHT IS POSED. This point is about FILES, so nothing is posed and no
// game is driven. The evidence is the six files laid side by side.
//
// TOLERANCE. None. Six exact paths, an exact canvas, and a count.

import { it } from "vitest";
import { captureCanvas } from "../harness";
import { WALK_SPRITES, assertProduced, readSprites, sheetOf } from "./produced";

it("commits six walk frames, each a painted 24 x 32 file of its own", async () => {
  const reads = await readSprites(WALK_SPRITES);

  captureCanvas(
    await sheetOf(WALK_SPRITES, { title: "assets/sprites/lamplighter/walk" }),
    "walk",
  );

  for (const read of reads) assertProduced(read);
});
