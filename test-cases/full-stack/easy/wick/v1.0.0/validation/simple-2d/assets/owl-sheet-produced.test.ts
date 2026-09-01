// Wick — assets/owl-sheet-produced: Owl's sheet ships four committed
// frames on its stated canvas, each painted, no two of them the same picture.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/assets.md (The sprites): the row
//     "`assets/sprites/enemies/owl/0.png` to `3.png` | `draw-sheet` | `4` |
//     `72 x 72`", under "A sheet's frames are separate PNG files, numbered
//     from `0`, each on a canvas of the sheet's size" and "of exactly the size
//     its row states".
//   - specs/assets.md (Animation): "An enemy draws frame
//     `floor(age / WALK_FRAME_TIME) mod 4` of its sheet for as long as it
//     lives", so all four frames are shown, in order, on a loop.
//   - `constants.ts` gives the canvas as `enemySpriteSize("owl")`, twice the
//     radius the `ENEMIES` table states for the row.
//   - The review item states the last of the four readings: the four frames are
//     produced, on their canvas, painted, and "no two identical".
//
// WHAT IS READ. The four files at `0.png` through `3.png`, each decoding, each
// exactly `72 x 72`, each carrying at least one pixel that is not fully
// transparent, and no two of the six pairs they make the same picture.
//
// HOW TWO FRAMES ARE COMPARED. Two fully transparent pixels count as the same
// pixel whatever colour bytes sit under them: a straight-alpha canvas leaves
// those undefined and a player sees nothing either way.
//
// WHAT IT DELIBERATELY DOES NOT READ. That Owl's sheet differs from the
// other twelve enemies' is `assets/enemy-sheets-distinct`; whether the four
// read as one continuous cycle is the art bar the presentation domain's rating
// judges.
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
  assertProduced,
  committed,
  enemySheet,
  firstIdenticalPair,
  readSprites,
  sheetOf,
} from "./produced";

const SHEET = enemySheet("owl");

it("commits four painted 72 x 72 owl frames, no two alike", async () => {
  const reads = await readSprites(SHEET);

  captureCanvas(
    await sheetOf(SHEET, { title: "assets/sprites/enemies/owl" }),
    "owl",
  );

  const pixels = reads.map((read) => assertProduced(read));
  const pair = firstIdenticalPair(SHEET, pixels);
  if (pair !== null) {
    fail(
      "four owl frames, no two of them the same picture",
      `${committed(pair[0])} and ${committed(pair[1])} are pixel-identical`,
    );
  }
});
