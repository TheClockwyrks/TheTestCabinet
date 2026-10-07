// assets/pickup-sprites-produced — the chest, the bread and the draft are three
// painted 24-pixel sprites, no two the same.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The sprites") gives the row
// "Pickups | `assets/sprites/pickups/chest.png`, `bread.png`, `draft.png` |
// `draw` | `1` each | `24 x 24`", under "Every sprite is pixel art drawn at one
// unit per pixel on a transparent, straight-alpha canvas of exactly the size its
// row states". The three kinds do three different things when they are collected,
// so a player reaching one has to know which it is, and the review item words the
// floor this point reads: no two of the three are pixel-identical.
//
// THE TOLERANCES. The three paths and the `24 x 24` canvas are exact figures and
// are read exactly. That each file carries a drawing rather than an empty canvas
// is read as presence: at least one pixel of the canvas is not clear.
// That no two are the same picture needs none: a PNG carries its pixels
// losslessly, so two files holding one picture differ on exactly nothing.
//
// WHAT IT DELIBERATELY DOES NOT READ. What each pickup does when collected is the
// pickups category's; how far apart the three LOOK is the art bar and the
// presentation domain's aesthetic rating.
//
// THE DRIVE. None. This point is about FILES, so it reads the repository the
// build produced and drives no game.

import { it } from "vitest";
import { writeImage } from "./media-out";
import {
  assertAllDistinct,
  assertProducedAt,
  decodeAll,
  decodeSprites,
  paintSprites,
  PICKUP_SPRITES,
} from "./sprites";

it("ships three distinct, painted 24 x 24 pickup sprites", async () => {
  const read = await decodeSprites(PICKUP_SPRITES);
  writeImage(
    "pickups",
    await paintSprites("The three pickup sprites", PICKUP_SPRITES, {
      checker: true,
      columns: 3,
      cell: 128,
    }),
  );

  for (const [index, pickup] of PICKUP_SPRITES.entries()) {
    assertProducedAt(pickup, read[index]!);
  }
  assertAllDistinct(await decodeAll(PICKUP_SPRITES));
});
