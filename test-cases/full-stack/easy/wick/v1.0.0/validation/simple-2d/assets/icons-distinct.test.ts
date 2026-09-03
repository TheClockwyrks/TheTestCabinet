// Wick — assets/icons-distinct: the twenty-seven icons are twenty-seven
// pictures rather than one picture reused.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/assets.md (The icons): "Each is told from every other at a glance,
//     and an evolved weapon's icon reads as a transformed version of its
//     base's."
//   - specs/assets.md (The icons): "The HUD's slots and the level-up and chest
//     overlays draw them beside the names `specs/ui.md` states", so a player
//     tells one item's slot from another's by its icon.
//   - The review item states the floor read here: "No two of the twenty-seven
//     icons are pixel-identical."
//
// WHAT IS READ. The three hundred and fifty-one pairs the twenty-seven icons
// make, compared pixel for pixel. Two items whose icons are the same file
// cannot be told apart at all, which is the far side of "told from every other
// at a glance"; whether two pictures that DO differ are distinguishable enough
// is the art bar the presentation domain's rating judges.
//
// HOW TWO FILES ARE COMPARED. Two fully transparent pixels count as the same
// pixel whatever colour bytes sit under them: a straight-alpha canvas leaves
// those undefined and a player sees nothing either way.
//
// WHAT IT DELIBERATELY DOES NOT READ. That each icon exists on its canvas and
// carries paint is `assets/icons-produced`.
//
// WHY NO NIGHT IS POSED. This point is about FILES, so nothing is posed and no
// game is driven. The evidence is the twenty-seven files laid out as a grid.
//
// TOLERANCE. None. Pixel identity is exact.

import { it } from "vitest";
import { fail } from "../assert";
import { captureCanvas } from "../harness";
import {
  ICON_SPRITES,
  committed,
  firstIdenticalPair,
  readSprites,
  requireAll,
  sheetOf,
} from "./produced";

it("draws each of the twenty-seven icons differently from the rest", async () => {
  const pixels = requireAll(await readSprites(ICON_SPRITES));

  captureCanvas(
    await sheetOf(ICON_SPRITES, {
      title: "assets/icons — sixteen weapons, ten passives, lamp oil",
    }),
    "distinct",
  );

  const pair = firstIdenticalPair(ICON_SPRITES, pixels);
  if (pair !== null) {
    fail(
      "twenty-seven icons, no two of them the same picture",
      `${committed(pair[0])} and ${committed(pair[1])} are pixel-identical`,
    );
  }
});
