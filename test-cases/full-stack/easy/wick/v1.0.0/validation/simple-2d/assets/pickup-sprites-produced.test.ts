// Wick — assets/pickup-sprites-produced: the three pickups are committed files
// on their stated canvas, each painted, no two of them the same picture.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/assets.md (The sprites): "Pickups |
//     `assets/sprites/pickups/chest.png`, `bread.png`, `draft.png` | `draw` |
//     `1` each | `24 x 24`", under "of exactly the size its row states".
//   - `constants.ts` carries the paths and the square as `PICKUP_PATHS` and
//     `PICKUP_SPRITE_SIZE`, in `PICKUP_KINDS` order.
//   - The review item states the last of the three readings: the three sprites
//     are produced, on their canvas, painted, and "no two identical". The three
//     are three different things a player picks up, and a chest that arrives
//     wearing the bread's picture cannot be told from bread.
//
// WHAT IS READ. The three files, each decoding, each exactly `24 x 24`, each
// carrying at least one pixel that is not fully transparent, and no two of the
// three pairs they make the same picture.
//
// HOW TWO FILES ARE COMPARED. Two fully transparent pixels count as the same
// pixel whatever colour bytes sit under them: a straight-alpha canvas leaves
// those undefined and a player sees nothing either way.
//
// WHAT IT DELIBERATELY DOES NOT READ. What each pickup does on collection is
// the pickups category's; whether the three read apart at a glance is the art
// bar the presentation domain's rating judges.
//
// WHY NO NIGHT IS POSED. This point is about FILES, so nothing is posed and no
// game is driven. The evidence is the three files side by side, magnified.
//
// TOLERANCE. None. Three exact paths, an exact canvas, a count, and exact pixel
// identity.

import { it } from "vitest";
import { fail } from "../assert";
import { captureCanvas } from "../harness";
import {
  PICKUP_SPRITES,
  assertProduced,
  committed,
  firstIdenticalPair,
  readSprites,
  sheetOf,
} from "./produced";

it("commits three painted 24 x 24 pickups, no two alike", async () => {
  const reads = await readSprites(PICKUP_SPRITES);

  captureCanvas(
    await sheetOf(PICKUP_SPRITES, {
      title: "assets/sprites/pickups",
      checkerboard: true,
    }),
    "pickups",
  );

  const pixels = reads.map((read) => assertProduced(read));
  const pair = firstIdenticalPair(PICKUP_SPRITES, pixels);
  if (pair !== null) {
    fail(
      "three pickup sprites, no two of them the same picture",
      `${committed(pair[0])} and ${committed(pair[1])} are pixel-identical`,
    );
  }
});
