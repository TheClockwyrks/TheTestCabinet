// Wick — assets/enemy-sheets-distinct: the thirteen enemies are thirteen
// pictures rather than one picture reused.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/assets.md (The sprites): "Every enemy is told from every other at a
//     glance, by silhouette and not by hue alone, and the two elites and the
//     Dark read as larger and heavier than the commons."
//   - specs/assets.md (The sprites): each enemy's sheet sits under
//     `assets/sprites/enemies/<id>/`, so the thirteen ids of `ENEMY_IDS` are
//     thirteen sheets.
//   - The review item states the floor read here: "No two of the thirteen
//     enemies' `0.png` frames are pixel-identical."
//
// WHAT IS READ. The seventy-eight pairs the thirteen first frames make,
// compared pixel for pixel. Two enemies whose sheets carry the same file cannot
// be told apart at all, which is the far side of "told from every other at a
// glance"; whether two pictures that DO differ are distinguishable enough is
// the art bar the presentation domain's rating judges. The first frame stands
// for its sheet because every sheet starts at frame `0`
// (`floor(age / WALK_FRAME_TIME) mod 4` is `0` on the tick an enemy appears).
//
// HOW TWO FRAMES ARE COMPARED. Sheets of different canvases are different
// pictures outright, which is what the differing radii already give most of the
// roster. Otherwise two fully transparent pixels count as the same pixel
// whatever colour bytes sit under them.
//
// WHAT IT DELIBERATELY DOES NOT READ. That each sheet exists on its canvas is
// the sheet points'; that a sheet's own four frames differ is
// `assets/common-enemy-frames-distinct` and the elite and Dark points.
//
// WHY NO NIGHT IS POSED. This point is about FILES, so nothing is posed and no
// game is driven. The evidence is the thirteen first frames side by side.
//
// TOLERANCE. None. Pixel identity is exact.

import { it } from "vitest";
import { fail } from "../assert";
import { captureCanvas } from "../harness";
import {
  ENEMY_FIRST_FRAMES,
  committed,
  firstIdenticalPair,
  readSprites,
  requireAll,
  sheetOf,
} from "./produced";

it("draws each of the thirteen enemies differently from the rest", async () => {
  const pixels = requireAll(await readSprites(ENEMY_FIRST_FRAMES));

  captureCanvas(
    await sheetOf(ENEMY_FIRST_FRAMES, {
      title: "assets/sprites/enemies — every roster sheet's first frame",
    }),
    "roster",
  );

  const pair = firstIdenticalPair(ENEMY_FIRST_FRAMES, pixels);
  if (pair !== null) {
    fail(
      "thirteen enemy sheets, no two of them opening on the same picture",
      `${committed(pair[0])} and ${committed(pair[1])} are pixel-identical`,
    );
  }
});
