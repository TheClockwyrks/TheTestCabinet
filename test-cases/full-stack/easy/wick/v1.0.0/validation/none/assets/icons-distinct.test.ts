// assets/icons-distinct — the twenty-seven icons are twenty-seven drawings.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The icons"): "Each is told
// from every other at a glance, and an evolved weapon's icon reads as a
// transformed version of its base's." An icon shipped as a copy of another's is
// told from it by nothing at all, and a player choosing between three offers is
// reading exactly these pictures, so the review item words the floor this point
// reads: no two of the twenty-seven are pixel-identical.
//
// THE TOLERANCE. None, and none is needed: a PNG carries its pixels losslessly,
// so two files holding one picture differ on exactly nothing. How far apart two
// icons must LOOK — "told from every other at a glance" — is the art bar and the
// presentation domain's aesthetic rating, which is a person's to make.
//
// WHAT IT DELIBERATELY DOES NOT READ. That each exists at `24 x 24` and carries
// paint is `assets/icons-produced`.
//
// THE DRIVE. None. This point is about FILES, so it reads the repository the
// build produced and drives no game.

import { it } from "vitest";
import { writeImage } from "./media-out";
import {
  assertAllDistinct,
  decodeAll,
  ICON_SPRITES,
  paintSprites,
} from "./sprites";

it("draws each of the twenty-seven icons differently from the rest", async () => {
  // Painted before anything is read, so a file that will not decode still leaves
  // the picture that shows what the build shipped.
  writeImage(
    "distinct",
    await paintSprites("The icons side by side", ICON_SPRITES, {
      checker: true,
      columns: 7,
      cell: 96,
    }),
  );

  assertAllDistinct(await decodeAll(ICON_SPRITES));
});
