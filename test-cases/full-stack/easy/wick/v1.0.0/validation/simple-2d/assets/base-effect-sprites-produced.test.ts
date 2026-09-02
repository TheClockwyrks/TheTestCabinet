// Wick — assets/base-effect-sprites-produced: the ten base weapons' effects are
// committed at the paths and canvases their rows fix, every frame painted.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/assets.md (The weapon effects): the ten rows, each naming the
//     weapon's files, its form, and its canvas — slash `taper.png` on
//     `120 x 40`, bolt `ember.png` on `16 x 16`, dart `pin.png` on `12 x 12`,
//     lantern `lantern.png` on `28 x 28`, aura ring `halo.png` on `160 x 160`,
//     puddle `oil-splash.png` on `100 x 100`, strike `spark/0.png` to `3.png`
//     on `80 x 80`, shard `shard.png` on `16 x 16`, sconce `sconce/0.png` to
//     `3.png` on `24 x 24`, and flare burst `flare/0.png` to `5.png` on
//     `128 x 128`.
//   - specs/assets.md (The weapon effects): "Each is produced on the canvas its
//     row states and scaled in code to the live shape", and (The sprites) "A
//     sheet's frames are separate PNG files, numbered from `0`, each on a canvas
//     of the sheet's size".
//   - `constants.ts` carries every path, frame count and canvas as
//     `EFFECT_SPRITES`, and `BASE_WEAPON_IDS` names the ten.
//
// WHAT IS READ. All twenty-seven files the ten rows come to, each decoding,
// each on the exact canvas its row states, each carrying at least one pixel
// that is not fully transparent.
//
// WHAT IT DELIBERATELY DOES NOT READ. That the six evolved effects ship is
// `assets/evolved-effect-sprites-produced`, and that each differs from its
// base's is `assets/evolved-effects-differ-from-base`; where and how big each
// effect is drawn is each weapon's own presentation point.
//
// WHY NO NIGHT IS POSED. This point is about FILES, so nothing is posed and no
// game is driven. The evidence is the twenty-seven files laid out as a grid.
//
// TOLERANCE. None. Twenty-seven exact paths, ten exact canvases, and a count.

import { it } from "vitest";
import { captureCanvas } from "../harness";
import {
  BASE_EFFECT_SPRITES,
  assertProduced,
  readSprites,
  sheetOf,
} from "./produced";

it("commits every frame of the ten base effects on its stated canvas", async () => {
  const reads = await readSprites(BASE_EFFECT_SPRITES);

  captureCanvas(
    await sheetOf(BASE_EFFECT_SPRITES, {
      title: "assets/sprites/effects — the ten base weapons",
    }),
    "effects",
  );

  for (const read of reads) assertProduced(read);
});
