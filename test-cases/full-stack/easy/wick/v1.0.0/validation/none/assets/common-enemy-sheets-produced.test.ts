// assets/common-enemy-sheets-produced — each of the ten common enemies ships a
// four-frame sheet on the square its radius fixes.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The sprites") gives the row
// "Each common enemy, a walk cycle | `assets/sprites/enemies/<id>/0.png` to
// `3.png`, for each of the ten common ids in `ENEMY_IDS` | `draw-sheet` | `4` |
// twice its radius in `ENEMIES`, square: `20` for `moth`, `20` for `bat`, `24`
// for `rat`, `16` for `gnat`, `28` for `beetle`, `20` for `wisp`, `28` for
// `spider`, `24` for `crow`, `32` for `shade`, `36` for `hound`", under "A
// sheet's frames are separate PNG files, numbered from `0`, each on a canvas of
// the sheet's size." So the canvas each frame must stand on is twice that
// enemy's radius, exactly, and the four paths are fixed. That each file carries
// a drawing rather than an empty canvas is read against `PAINT_MIN_SHARE`, whose
// reasoning `assets/sprites.ts` states.
//
// WHAT IT DELIBERATELY DOES NOT READ. That a sheet's four frames differ from one
// another is `assets/common-enemy-frames-distinct`; that the ten sheets differ
// from each other is `assets/enemy-sheets-distinct`; the two elites and the Dark
// have sheets and points of their own.
//
// THE DRIVE. None. This point is about FILES, so it reads the repository the
// build produced and drives no game.

import { it } from "vitest";
import { writeImage } from "./media-out";
import {
  assertProducedAt,
  COMMON_SHEETS,
  decodeSprites,
  paintSprites,
} from "./sprites";

/** The forty frames the ten sheets are, in `ENEMY_IDS` order then frame order. */
const FRAMES = COMMON_SHEETS.flat();

it("ships four painted frames for each of the ten common enemies", async () => {
  const read = await decodeSprites(FRAMES);
  writeImage(
    "sheets",
    await paintSprites("The ten common sheets", FRAMES, {
      checker: true,
      columns: 4,
      cell: 96,
    }),
  );

  for (const [index, frame] of FRAMES.entries()) {
    assertProducedAt(frame, read[index]!);
  }
});
