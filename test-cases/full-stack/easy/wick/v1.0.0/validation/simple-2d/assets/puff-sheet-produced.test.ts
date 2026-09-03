// Wick — assets/puff-sheet-produced: the shared death puff ships four committed
// frames on its stated canvas, each painted, no two of them the same picture.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/assets.md (The sprites): "Death puff, shared by every enemy |
//     `assets/sprites/puff/0.png` to `3.png` | `draw-sheet` | `4` | `24 x 24`",
//     under "A sheet's frames are separate PNG files, numbered from `0`, each
//     on a canvas of the sheet's size" and "of exactly the size its row
//     states".
//   - specs/assets.md (Animation): "The death puff is drawn centered on the
//     position an enemy died at, frame `floor(t / (PUFF_TIME / 4))` ... and is
//     gone after", so all four frames play once through over `PUFF_TIME`.
//   - `constants.ts` carries the directory, the count, and the canvas as
//     `PUFF_DIR`, `PUFF_FRAMES`, and `PUFF_SPRITE_SIZE`.
//   - The review item states the last of the four readings: the four frames are
//     produced, on their canvas, painted, and "no two identical".
//
// WHAT IS READ. The four files at `0.png` through `3.png`, each decoding, each
// exactly `24 x 24`, each carrying at least one pixel that is not fully
// transparent, and no two of the six pairs they make the same picture.
//
// HOW TWO FRAMES ARE COMPARED. Two fully transparent pixels count as the same
// pixel whatever colour bytes sit under them: a straight-alpha canvas leaves
// those undefined and a player sees nothing either way. That matters most here,
// where a puff is mostly clear ground.
//
// WHAT IT DELIBERATELY DOES NOT READ. Which frame is drawn at which point of
// `PUFF_TIME` is the puff's own presentation point; whether the four read as a
// burst dispersing is the art bar the presentation domain's rating judges.
//
// WHY NO NIGHT IS POSED. This point is about FILES, so nothing is posed and no
// game is driven. The evidence is the four frames side by side.
//
// TOLERANCE. None. Four exact paths, an exact canvas, a count, and exact pixel
// identity.

import { it } from "vitest";
import { fail } from "../assert";
import { captureCanvas } from "../harness";
import {
  PUFF_SPRITES,
  assertProduced,
  committed,
  firstIdenticalPair,
  readSprites,
  sheetOf,
} from "./produced";

it("commits four painted 24 x 24 puff frames, no two alike", async () => {
  const reads = await readSprites(PUFF_SPRITES);

  captureCanvas(
    await sheetOf(PUFF_SPRITES, {
      title: "assets/sprites/puff",
      checkerboard: true,
    }),
    "puff",
  );

  const pixels = reads.map((read) => assertProduced(read));
  const pair = firstIdenticalPair(PUFF_SPRITES, pixels);
  if (pair !== null) {
    fail(
      "four puff frames, no two of them the same picture",
      `${committed(pair[0])} and ${committed(pair[1])} are pixel-identical`,
    );
  }
});
