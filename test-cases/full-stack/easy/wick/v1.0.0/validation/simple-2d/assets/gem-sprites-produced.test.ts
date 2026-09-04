// Wick — assets/gem-sprites-produced: the three gem tiers are committed files,
// each on the canvas its tier fixes, each painted.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/assets.md (The sprites): "Gems | `assets/sprites/gems/small.png`,
//     `medium.png`, `large.png` | `draw` | `1` each | `8 x 8`, `12 x 12`,
//     `16 x 16`", under "of exactly the size its row states".
//   - specs/assets.md (The sprites): "The three gem tiers are told apart by
//     size and form", so the three canvases are three different squares and the
//     sizes carry part of the distinction on their own.
//   - `constants.ts` carries the paths and the squares as `GEM_PATHS` and
//     `GEM_SPRITE_SIZES`, in `GEM_TIERS` order.
//
// WHAT IS READ. The three files, each decoding, each exactly on its tier's
// square, each carrying at least one pixel that is not fully transparent.
//
// WHAT IT DELIBERATELY DOES NOT READ. Which gem a tier is drawn from at play is
// the pickups' presentation point; whether the three forms read apart at a
// glance is the art bar the presentation domain's rating judges.
//
// WHY NO NIGHT IS POSED. This point is about FILES, so nothing is posed and no
// game is driven. The evidence is the three files side by side, magnified.
//
// TOLERANCE. None. Three exact paths, three exact canvases, and a count.

import { it } from "vitest";
import { captureCanvas } from "../harness";
import { GEM_SPRITES, assertProduced, readSprites, sheetOf } from "./produced";

it("commits the three gems at 8, 12, and 16 pixels square, each painted", async () => {
  const reads = await readSprites(GEM_SPRITES);

  captureCanvas(
    await sheetOf(GEM_SPRITES, {
      title: "assets/sprites/gems",
      checkerboard: true,
    }),
    "gems",
  );

  for (const read of reads) assertProduced(read);
});
