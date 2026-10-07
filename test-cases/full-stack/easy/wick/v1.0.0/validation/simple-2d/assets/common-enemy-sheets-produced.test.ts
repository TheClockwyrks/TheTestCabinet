// Wick — assets/common-enemy-sheets-produced: each of the ten common enemies
// ships a four-frame sheet on the square its radius fixes, each frame painted.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/assets.md (The sprites): "Each common enemy, a walk cycle |
//     `assets/sprites/enemies/<id>/0.png` to `3.png`, for each of the ten
//     common ids in `ENEMY_IDS` | `draw-sheet` | `4` | twice its radius in
//     `ENEMIES`, square: `20` for `moth`, `20` for `bat`, `24` for `rat`, `16`
//     for `gnat`, `28` for `beetle`, `20` for `wisp`, `28` for `spider`, `24`
//     for `crow`, `32` for `shade`, `36` for `hound`".
//   - specs/assets.md (The sprites): "A sheet's frames are separate PNG files,
//     numbered from `0`, each on a canvas of the sheet's size", and every
//     sprite is "of exactly the size its row states".
//   - `constants.ts` carries the ten ids as `COMMON_ENEMY_IDS`, the count as
//     `ENEMY_FRAMES`, and the canvas as `enemySpriteSize`, which is twice the
//     radius the `ENEMIES` table gives each row.
//
// WHAT IS READ. All forty files, ten sheets of four, each decoding, each on the
// exact square its enemy's radius fixes, each carrying at least one pixel that
// is not fully transparent.
//
// WHAT IT DELIBERATELY DOES NOT READ. That a sheet's four frames differ is
// `assets/common-enemy-frames-distinct`; that the ten enemies differ from one
// another is `assets/enemy-sheets-distinct`; the two elites and the Dark have
// their own points.
//
// WHY NO NIGHT IS POSED. This point is about FILES, so nothing is posed and no
// game is driven. The evidence is the forty frames laid out as a grid.
//
// TOLERANCE. None. Forty exact paths, ten exact canvases, and a count.

import { it } from "vitest";
import { captureCanvas } from "../harness";
import {
  COMMON_ENEMY_SPRITES,
  assertProduced,
  readSprites,
  sheetOf,
} from "./produced";

it("commits four painted frames for each of the ten common enemies", async () => {
  const reads = await readSprites(COMMON_ENEMY_SPRITES);

  captureCanvas(
    await sheetOf(COMMON_ENEMY_SPRITES, {
      title: "assets/sprites/enemies — the ten common sheets",
    }),
    "sheets",
  );

  for (const read of reads) assertProduced(read);
});
