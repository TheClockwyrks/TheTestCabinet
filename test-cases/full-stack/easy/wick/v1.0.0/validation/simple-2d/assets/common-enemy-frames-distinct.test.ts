// Wick — assets/common-enemy-frames-distinct: each common enemy's sheet is four
// poses of a walk rather than a cycle padded with repeats.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/assets.md (The sprites): "Each common enemy, a walk cycle ...
//     `draw-sheet` ... `4`", under the tool that produces "everything that
//     moves on its own".
//   - specs/assets.md (Animation): "An enemy draws frame
//     `floor(age / WALK_FRAME_TIME) mod 4` of its sheet for as long as it
//     lives", so all four frames are shown, in order, on a loop.
//   - The review item states the floor read here: "For each of the ten common
//     sheets, no two of its four frames are pixel-identical."
//
// WHAT IS READ. For each of the ten sheets, the six pairs its four frames make,
// compared pixel for pixel. A frame shipped twice differs by exactly nothing,
// since a PNG carries its pixels losslessly.
//
// HOW TWO FRAMES ARE COMPARED. Two fully transparent pixels count as the same
// pixel whatever colour bytes sit under them: a straight-alpha canvas leaves
// those undefined and a player sees nothing either way.
//
// WHAT IT DELIBERATELY DOES NOT READ. That each frame exists on its canvas and
// carries paint is `assets/common-enemy-sheets-produced`; whether the four read
// as one continuous walk is the art bar the presentation domain's rating
// judges.
//
// WHY NO NIGHT IS POSED. This point is about FILES, so nothing is posed and no
// game is driven. The evidence is the forty frames laid out as a grid.
//
// TOLERANCE. None. Pixel identity is exact.

import { it } from "vitest";
import { fail } from "../assert";
import { COMMON_ENEMY_IDS } from "../constants";
import { captureCanvas } from "../harness";
import {
  COMMON_ENEMY_SPRITES,
  committed,
  enemySheet,
  firstIdenticalPair,
  readSprites,
  requireAll,
  sheetOf,
} from "./produced";

it("draws each common enemy's four frames differently from one another", async () => {
  captureCanvas(
    await sheetOf(COMMON_ENEMY_SPRITES, {
      title: "assets/sprites/enemies — the ten common sheets",
    }),
    "distinct",
  );

  for (const id of COMMON_ENEMY_IDS) {
    const sheet = enemySheet(id);
    const pixels = requireAll(await readSprites(sheet));
    const pair = firstIdenticalPair(sheet, pixels);
    if (pair !== null) {
      fail(
        `${id}'s four frames, no two of them the same picture`,
        `${committed(pair[0])} and ${committed(pair[1])} are pixel-identical`,
      );
    }
  }
});
